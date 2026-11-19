/**
 * The tool loop (spec 06 §7, D-101): one testimony is a chain of up to `maxSteps` paid calls, each
 * with its own guarded claim, fresh fence, lease and fenced commit, keeping the paid-call shape of
 * `generation.ts`: outbox → job (IDs only) → guarded claim → owned-key call outside any
 * transaction → commit only if the fence, run, deletion state and credential are all current.
 *
 * Moving to the next step is not a retry: every step was planned, shown in the preview, consented
 * to and reserved (`step_reservations`, one row per planned call) at hearing start. Only the
 * commit of step k creates step k+1 (pending) and its `step_outbox` row; a step is claimed once and
 * never sent twice; a step after a failure or an uncertain outcome is never sent, so its unit is
 * provably unsent and released. No automatic paid retry exists anywhere in this module.
 */

import { LIMITS } from '../../domain/limits'
import { buildToolPrompt, TOOLS_TEMPLATE_VERSION } from '../../domain/messages'
import type { ProviderId } from '../../domain/registry'
import { isImportedSnapshot, type RunSnapshot } from '../../domain/snapshot'
import { answerCalls } from '../../domain/tools/mock'
import { toolTaskOf, type ToolsFields } from '../../domain/tools/task'
import { answeredCount, callCount, finishTrace, jurorTrace, stepText, traceBytes, traceCalls, type TraceCall, type TraceEnd, type TraceStep } from '../../domain/tools/trace'
import { all, auditStatement, cond, GuardFailed, releaseReservations, runGuarded, type Condition } from '../db/sql'
import type { Deps, GenerationJob, ToolStepJob } from '../deps'
import type { ProviderErrorCode } from '../providers/common'
import { toolAdapterFor, type StepReplay, type ToolStepOutcome } from '../providers/tools'
import { checkRowFor, insertTestimonyChecksStatement } from './checks'
import { CredentialUnusable, withRunCredential } from './credentials'
// Function-only cycles (generation.ts and runs.ts import this module); nothing runs at import time.
import { notifyRun, touchRunStatement, type ClaimContext, type JobOutcome } from './generation'
import { autoOpenReview } from './runs'

export const TOOL_STEP_JOB_TYPE = 'mc.tool-step'

/** A tool hearing (spec 06): its recorded template is `tools-v1`, so its attempts run the loop. */
export function isToolHearing(snapshot: Partial<Pick<RunSnapshot, 'messageTemplateVersion'>>): boolean {
  return snapshot.messageTemplateVersion === TOOLS_TEMPLATE_VERSION
}

class StepFenced extends Error {}
class HistoryUnavailable extends Error {}

interface StepRef {
  runId: string
  provider: ProviderId
  caseKey: string
  configurationKey: string
  snapshot: RunSnapshot
  generationId: string
  attemptNo: number
  attemptId: string
  stepId: string
  stepNo: number
  fence: string
  requestId: string
}

/** A finished earlier step of the same attempt, as the next request and the trace need it. */
interface PriorStep extends TraceStep {
  replay: StepReplay
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  durationMs: number | null
}

function runOpen(runId: string): Condition {
  return cond(`EXISTS (SELECT 1 FROM runs r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = ? AND r.status = 'generating' AND e.deleted_at IS NULL)`, runId)
}

function credentialActive(runId: string, provider: ProviderId): Condition {
  return cond(`EXISTS (SELECT 1 FROM run_credentials rc JOIN provider_credentials c ON c.id = rc.credential_id WHERE rc.run_id = ? AND rc.provider = ? AND c.status = 'active')`, runId, provider)
}

function stepCurrent(stepId: string, fence: string): Condition {
  return cond(`EXISTS (SELECT 1 FROM generation_steps WHERE id = ? AND fence_token = ? AND status = 'running')`, stepId, fence)
}

/** Re-checked immediately before the POST, inside the credential callback. */
export async function stepStillCurrent(db: D1Database, stepId: string, fence: string, runId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM generation_steps s, runs r JOIN evaluations e ON e.id = r.evaluation_id
       WHERE s.id = ? AND s.fence_token = ? AND s.status = 'running' AND r.id = ? AND r.status = 'generating' AND e.deleted_at IS NULL`,
    )
    .bind(stepId, fence, runId)
    .first()
  return row !== null
}

/** The step reservations of one attempt in a state, from a step on (`stepNo` and later) or only after it. */
function releaseSteps(db: D1Database, generationId: string, attemptNo: number, from: { after: number } | { at: number }, state: 'reserved' | 'consumed', now: number): D1PreparedStatement[] {
  const scope = 'after' in from ? cond('r.generation_id = ? AND r.attempt_no = ? AND r.step_no > ?', generationId, attemptNo, from.after) : cond('r.generation_id = ? AND r.attempt_no = ? AND r.step_no = ?', generationId, attemptNo, from.at)
  return releaseReservations(db, scope, state, now, 'step_reservations')
}

/** Provider-native replay data is dropped from every finished step of the attempt (spec 06 §6.3). Put after the status updates. */
function dropReplayStatement(db: D1Database, attemptId: string): D1PreparedStatement {
  return db.prepare(`UPDATE generation_steps SET replay_json = NULL WHERE attempt_id = ? AND replay_json IS NOT NULL AND status NOT IN ('pending','running')`).bind(attemptId)
}

// ---------------------------------------------------------------------------
// Step 1: the attempt's own `mc.generate` job (spec 06 §7.2)
// ---------------------------------------------------------------------------

export async function handleToolAttemptJob(deps: Deps, job: GenerationJob, context: ClaimContext, jobSignal: AbortSignal, requestId: string): Promise<JobOutcome> {
  const db = deps.db
  const claimedAt = deps.now()
  const attemptId = deps.newId()
  const attemptFence = deps.newId()
  const stepId = deps.newId()
  const fence = deps.newId()
  try {
    await runGuarded(
      db,
      'tool.claim',
      all(
        cond(`EXISTS (SELECT 1 FROM generations WHERE id = ? AND status = 'pending' AND attempt_count = ?)`, job.generationId, job.attemptNo),
        runOpen(context.runId),
        cond(`EXISTS (SELECT 1 FROM step_reservations WHERE generation_id = ? AND attempt_no = ? AND step_no = 1 AND state = 'reserved')`, job.generationId, job.attemptNo),
        credentialActive(context.runId, context.provider),
      ),
      [
        db.prepare(`UPDATE generations SET status = 'running', updated_at = ? WHERE id = ?`).bind(claimedAt, job.generationId),
        // The attempt row is only the loop's container: no call is in flight between steps, so its own
        // deadline is never reconciled (reconcileLeases skips tool attempts); each step has its own lease.
        db
          .prepare(
            `INSERT INTO generation_attempts (id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, queue_wait_ms, kind)
             VALUES (?, ?, ?, ?, 'running', ?, ?, ?, 'tool_loop')`,
          )
          .bind(attemptId, job.generationId, job.attemptNo, attemptFence, claimedAt, claimedAt + LIMITS.attemptLeaseMs * LIMITS.tools.maxSteps, Math.max(0, claimedAt - context.queuedAt)),
        db
          .prepare(
            `INSERT INTO generation_steps (id, attempt_id, generation_id, attempt_no, step_no, status, fence_token, claimed_at, deadline_at, queue_wait_ms, created_at)
             VALUES (?, ?, ?, ?, 1, 'running', ?, ?, ?, ?, ?)`,
          )
          .bind(stepId, attemptId, job.generationId, job.attemptNo, fence, claimedAt, claimedAt + LIMITS.attemptLeaseMs, Math.max(0, claimedAt - context.queuedAt), claimedAt),
        db.prepare(`UPDATE step_reservations SET state = 'consumed' WHERE generation_id = ? AND attempt_no = ? AND step_no = 1 AND state = 'reserved'`).bind(job.generationId, job.attemptNo),
        db.prepare(`UPDATE outbox SET status = 'claimed', updated_at = ? WHERE id = ?`).bind(claimedAt, job.outboxId),
        touchRunStatement(db, context.runId, claimedAt),
        auditStatement(db, { eventType: 'step.claim', requestId, outcome: 'ok', runId: context.runId, metadata: { generationId: job.generationId, attemptNo: job.attemptNo, stepNo: 1 } }, claimedAt),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) {
      deps.log({ event: 'step.claim_skipped', generationId: job.generationId, attemptNo: job.attemptNo, stepNo: 1 })
      return 'not_claimed'
    }
    throw error
  }
  await notifyRun(deps, context.runId)
  return runStep(deps, { ...context, generationId: job.generationId, attemptNo: job.attemptNo, attemptId, stepId, stepNo: 1, fence, requestId }, jobSignal)
}

// ---------------------------------------------------------------------------
// Steps 2..N: `mc.tool-step` jobs (spec 06 §7.3)
// ---------------------------------------------------------------------------

export async function handleToolStepJob(deps: Deps, job: ToolStepJob, jobSignal: AbortSignal, requestId: string): Promise<JobOutcome> {
  const db = deps.db
  const row = await db
    .prepare(
      `SELECT s.attempt_id, s.created_at, g.run_id, g.provider, g.case_key, g.configuration_key, r.snapshot_json
       FROM generation_steps s JOIN generations g ON g.id = s.generation_id JOIN runs r ON r.id = g.run_id JOIN step_outbox o ON o.step_id = s.id
       WHERE s.id = ? AND s.generation_id = ? AND s.attempt_no = ? AND s.step_no = ? AND o.id = ?`,
    )
    .bind(job.stepId, job.generationId, job.attemptNo, job.stepNo, job.stepOutboxId)
    .first<{ attempt_id: string; created_at: number; run_id: string; provider: ProviderId; case_key: string; configuration_key: string; snapshot_json: string }>()
  if (!row) return 'not_claimed'
  const claimedAt = deps.now()
  const fence = deps.newId()
  try {
    await runGuarded(
      db,
      'tool.step_claim',
      all(
        cond(`EXISTS (SELECT 1 FROM generation_steps WHERE id = ? AND status = 'pending' AND fence_token IS NULL)`, job.stepId),
        cond(`EXISTS (SELECT 1 FROM generation_attempts WHERE id = ? AND status = 'running' AND kind = 'tool_loop')`, row.attempt_id),
        cond(`EXISTS (SELECT 1 FROM generations WHERE id = ? AND status = 'running' AND attempt_count = ?)`, job.generationId, job.attemptNo),
        runOpen(row.run_id),
        cond(`EXISTS (SELECT 1 FROM step_reservations WHERE generation_id = ? AND attempt_no = ? AND step_no = ? AND state = 'reserved')`, job.generationId, job.attemptNo, job.stepNo),
        credentialActive(row.run_id, row.provider),
      ),
      [
        db
          .prepare(`UPDATE generation_steps SET status = 'running', fence_token = ?, claimed_at = ?, deadline_at = ?, queue_wait_ms = ? WHERE id = ?`)
          .bind(fence, claimedAt, claimedAt + LIMITS.attemptLeaseMs, Math.max(0, claimedAt - row.created_at), job.stepId),
        db.prepare(`UPDATE step_reservations SET state = 'consumed' WHERE generation_id = ? AND attempt_no = ? AND step_no = ? AND state = 'reserved'`).bind(job.generationId, job.attemptNo, job.stepNo),
        db.prepare(`UPDATE step_outbox SET status = 'claimed', updated_at = ? WHERE id = ?`).bind(claimedAt, job.stepOutboxId),
        touchRunStatement(db, row.run_id, claimedAt),
        auditStatement(db, { eventType: 'step.claim', requestId, outcome: 'ok', runId: row.run_id, metadata: { generationId: job.generationId, attemptNo: job.attemptNo, stepNo: job.stepNo } }, claimedAt),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) {
      deps.log({ event: 'step.claim_skipped', generationId: job.generationId, attemptNo: job.attemptNo, stepNo: job.stepNo })
      return 'not_claimed' // duplicate, stale, canceled, revoked, or deleted: nothing is sent
    }
    throw error
  }
  await notifyRun(deps, row.run_id)
  const ref: StepRef = {
    runId: row.run_id,
    provider: row.provider,
    caseKey: row.case_key,
    configurationKey: row.configuration_key,
    snapshot: JSON.parse(row.snapshot_json) as RunSnapshot,
    generationId: job.generationId,
    attemptNo: job.attemptNo,
    attemptId: row.attempt_id,
    stepId: job.stepId,
    stepNo: job.stepNo,
    fence,
    requestId,
  }
  return runStep(deps, ref, jobSignal)
}

// ---------------------------------------------------------------------------
// Send (spec 06 §7.4)
// ---------------------------------------------------------------------------

async function loadHistory(db: D1Database, ref: StepRef): Promise<PriorStep[]> {
  const rows = (
    await db
      .prepare(
        `SELECT step_no, status, text, calls_json, replay_json, finish_reason, truncated, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, duration_ms
         FROM generation_steps WHERE attempt_id = ? AND step_no < ? ORDER BY step_no`,
      )
      .bind(ref.attemptId, ref.stepNo)
      .all<{ step_no: number; status: string; text: string | null; calls_json: string | null; replay_json: string | null; finish_reason: string | null; truncated: number; input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null; reasoning_tokens: number | null; duration_ms: number | null }>()
  ).results
  if (rows.length !== ref.stepNo - 1) throw new HistoryUnavailable()
  return rows.map((row, index) => {
    if (row.step_no !== index + 1 || row.status !== 'succeeded' || row.replay_json === null || row.calls_json === null) throw new HistoryUnavailable()
    const replay = JSON.parse(row.replay_json) as StepReplay
    const calls = JSON.parse(row.calls_json) as TraceCall[]
    if (replay.provider !== ref.provider || replay.callIds.length !== calls.length) throw new HistoryUnavailable()
    return {
      stepNo: row.step_no,
      text: row.text,
      calls,
      finishReason: row.finish_reason,
      truncated: row.truncated === 1,
      replay,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cachedInputTokens: row.cached_input_tokens,
      reasoningTokens: row.reasoning_tokens,
      durationMs: row.duration_ms,
    }
  })
}

function unsentFailure(code: ProviderErrorCode): ToolStepOutcome {
  return { kind: 'failure', code, definite: true, providerRequestId: null, durationMs: 0 }
}

async function runStep(deps: Deps, ref: StepRef, jobSignal: AbortSignal): Promise<JobOutcome> {
  const testCase = ref.snapshot.cases.find((item) => item.key === ref.caseKey)
  const found = ref.snapshot.configurations.find((item) => item.key === ref.configurationKey)
  // Imported parties never have generations; refuse rather than call a provider for one.
  const configuration = found && !isImportedSnapshot(found) ? found : undefined
  const task = toolTaskOf(testCase?.kitFields)
  // The fixed part of the request comes from the snapshot only (system, tools-v1 user message, tools),
  // so `system` and `tools` are byte-identical on every step; expectations never reach it.
  const prompt = testCase && configuration ? buildToolPrompt(ref.snapshot, configuration.systemPrompt, testCase) : null
  const adapter = configuration ? toolAdapterFor(configuration.adapterVersion, ref.provider) : null
  if (!testCase || !configuration || !task || !prompt || !adapter) return finishStep(deps, ref, task, [], unsentFailure('INVALID_PROVIDER_RESPONSE'), true)
  let history: PriorStep[]
  try {
    history = await loadHistory(deps.db, ref)
  } catch (error) {
    if (!(error instanceof HistoryUnavailable) && !(error instanceof SyntaxError)) throw error
    deps.log({ event: 'step.history_unavailable', generationId: ref.generationId, attemptNo: ref.attemptNo, stepNo: ref.stepNo })
    return finishStep(deps, ref, task, [], unsentFailure('INVALID_PROVIDER_RESPONSE'), true)
  }
  const timeout = AbortSignal.timeout(deps.config.providerTimeoutMs)
  const signal = AbortSignal.any([jobSignal, timeout])

  let outcome: ToolStepOutcome
  let unsent = false
  try {
    outcome = await withRunCredential(deps, ref.runId, ref.provider, ref.requestId, async (apiKey) => {
      // Canceled, deleted or revoked since the claim: send nothing.
      if (!(await stepStillCurrent(deps.db, ref.stepId, ref.fence, ref.runId))) throw new StepFenced()
      return adapter(
        deps.providerFetch,
        {
          modelId: configuration.modelId,
          system: prompt.system,
          user: prompt.user,
          tools: prompt.tools,
          history: history.map((step) => ({ replay: step.replay, results: step.calls.map((call) => ('notSent' in call.result ? { output: '', isError: true } : { output: call.result.text, isError: call.result.isError })) })),
          maxOutputTokens: configuration.maxOutputTokens,
          apiKey,
          signal,
        },
        timeout,
      )
    })
    if (outcome.kind === 'failure' && outcome.unsent) unsent = true
  } catch (error) {
    if (error instanceof StepFenced) {
      deps.log({ event: 'step.fenced_before_send', generationId: ref.generationId, attemptNo: ref.attemptNo, stepNo: ref.stepNo })
      await closeFencedStep(deps, ref)
      return 'stale'
    }
    if (error instanceof CredentialUnusable) {
      // Failed before any network send: no fallback key, no platform credit.
      unsent = true
      outcome = unsentFailure(error.code)
    } else {
      outcome = { kind: 'failure', code: 'PROVIDER_NETWORK_ERROR', definite: false, providerRequestId: null, durationMs: 0 }
    }
  }
  return finishStep(deps, ref, task, history, outcome, unsent)
}

/**
 * Provably unsent: give back this step's unit and every later one, and close the loop (like
 * `AttemptFenced`). The guard is the fence alone (D-105): every path that fences a step (cancel,
 * delete, revoke, lease expiry) also moves it off `running`, and this worker holds the only copy of
 * the fence and checked it before any send. Statuses another path already set are left as they are.
 */
async function closeFencedStep(deps: Deps, ref: StepRef): Promise<void> {
  const db = deps.db
  const now = deps.now()
  try {
    await runGuarded(db, 'tool.step_fenced', cond(`EXISTS (SELECT 1 FROM generation_steps WHERE id = ? AND fence_token = ?)`, ref.stepId, ref.fence), [
      ...releaseSteps(db, ref.generationId, ref.attemptNo, { at: ref.stepNo }, 'consumed', now),
      ...releaseSteps(db, ref.generationId, ref.attemptNo, { after: ref.stepNo }, 'reserved', now),
      db.prepare(`UPDATE generation_steps SET status = 'canceled', error_code = 'CANCELED', finished_at = ? WHERE id = ? AND status = 'running'`).bind(now, ref.stepId),
      db.prepare(`UPDATE generation_attempts SET status = 'canceled', error_code = 'CANCELED', finished_at = ? WHERE id = ? AND status = 'running'`).bind(now, ref.attemptId),
      db.prepare(`UPDATE generations SET status = 'canceled', last_error_code = 'CANCELED', updated_at = ? WHERE id = ? AND status = 'running'`).bind(now, ref.generationId),
      dropReplayStatement(db, ref.attemptId),
      db.prepare(`UPDATE step_outbox SET status = 'terminal', updated_at = ? WHERE step_id = ?`).bind(now, ref.stepId),
      db.prepare(`UPDATE outbox SET status = 'terminal', updated_at = ? WHERE generation_id = ? AND attempt_no = ?`).bind(now, ref.generationId, ref.attemptNo),
      touchRunStatement(db, ref.runId, now),
    ])
  } catch (error) {
    if (!(error instanceof GuardFailed)) throw error
  }
}

// ---------------------------------------------------------------------------
// Commit (spec 06 §7.5)
// ---------------------------------------------------------------------------

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

async function finishStep(deps: Deps, ref: StepRef, task: ToolsFields | undefined, history: readonly PriorStep[], outcome: ToolStepOutcome, unsent: boolean): Promise<JobOutcome> {
  const db = deps.db
  const now = deps.now()
  const current = all(stepCurrent(ref.stepId, ref.fence), runOpen(ref.runId))
  const terminalOutboxes = [
    db.prepare(`UPDATE step_outbox SET status = 'terminal', updated_at = ? WHERE step_id = ?`).bind(now, ref.stepId),
    db.prepare(`UPDATE outbox SET status = 'terminal', updated_at = ? WHERE generation_id = ? AND attempt_no = ?`).bind(now, ref.generationId, ref.attemptNo),
  ]
  const laterUnits = releaseSteps(db, ref.generationId, ref.attemptNo, { after: ref.stepNo }, 'reserved', now)
  const firstCallNo = callCount(history) + 1
  let result: JobOutcome
  let opened = false

  try {
    if (outcome.kind === 'success' && task) {
      const usage = [outcome.finishReason, outcome.inputTokens, outcome.outputTokens, outcome.cachedInputTokens, outcome.reasoningTokens, outcome.durationMs, outcome.providerRequestId, outcome.observedModel] as const
      const stepUpdate = (calls: TraceCall[], replay: StepReplay | null) =>
        db
          .prepare(
            `UPDATE generation_steps SET status = 'succeeded', finished_at = ?, stop_kind = ?, text = ?, calls_json = ?, replay_json = ?, finish_reason = ?, input_tokens = ?, output_tokens = ?,
               cached_input_tokens = ?, reasoning_tokens = ?, duration_ms = ?, provider_request_id = ?, observed_model = ?, truncated = ? WHERE id = ?`,
          )
          .bind(now, outcome.stop, stepText(outcome.text), JSON.stringify(calls), replay ? JSON.stringify(replay) : null, ...usage, outcome.truncated ? 1 : 0, ref.stepId)
      const credential = credentialActive(ref.runId, ref.provider)

      if (outcome.stop === 'tool_calls' && !outcome.truncated && ref.stepNo < task.maxSteps) {
        // The calls are answered from the frozen task only (pure); the next step is created by this commit.
        const answers = answerCalls(task, outcome.calls, answeredCount(history))
        const calls = traceCalls(task, outcome.calls, answers, firstCallNo)
        const nextStepId = deps.newId()
        await runGuarded(db, 'tool.step_complete', all(current, credential), [
          stepUpdate(calls, outcome.replay),
          db.prepare(`INSERT INTO generation_steps (id, attempt_id, generation_id, attempt_no, step_no, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`).bind(nextStepId, ref.attemptId, ref.generationId, ref.attemptNo, ref.stepNo + 1, now),
          db.prepare(`INSERT INTO step_outbox (id, step_id, generation_id, status, next_dispatch_at, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)`).bind(deps.newId(), nextStepId, ref.generationId, now, now, now),
          touchRunStatement(db, ref.runId, now),
          auditStatement(db, { eventType: 'step.complete', requestId: ref.requestId, outcome: 'tool_calls', runId: ref.runId, metadata: { generationId: ref.generationId, attemptNo: ref.attemptNo, stepNo: ref.stepNo, calls: calls.length } }, now),
        ])
        await dispatchStepOutbox(deps, ref.runId) // best effort; the minute cron re-dispatches anything left pending
        await notifyRun(deps, ref.runId)
        return 'continued'
      }

      // The loop ends: an answer, calls at the step cap (left unanswered), or a reply cut off at the output limit.
      const ended: TraceEnd = outcome.truncated ? 'truncated' : outcome.stop === 'answer' ? 'answered' : 'step_cap'
      const calls = traceCalls(task, outcome.calls, null, firstCallNo)
      const steps: TraceStep[] = [
        ...history.map((step) => ({ stepNo: step.stepNo, text: step.text, calls: step.calls, finishReason: step.finishReason, truncated: step.truncated })),
        { stepNo: ref.stepNo, text: stepText(outcome.text), calls, finishReason: outcome.finishReason, truncated: outcome.truncated },
      ]
      const trace = finishTrace(steps, ended)
      if (traceBytes(trace) <= LIMITS.tools.traceBytes) {
        const testCase = ref.snapshot.cases.find((item) => item.key === ref.caseKey)
        const finalText = trace.finalAnswer ?? ''
        // Spec 03 (D-76): checks commit in the same guarded batch as the testimony, on the juror projection.
        const checks = testCase ? checkRowFor(deps, ref.snapshot, testCase, { kind: 'toolTrace', text: finalText, trace: jurorTrace(trace) }) : null
        const all_ = [...history, { ...outcome }]
        await runGuarded(db, 'tool.attempt_complete', all(current, credential), [
          stepUpdate(calls, null),
          db
            .prepare(
              `UPDATE generation_attempts SET status = 'succeeded', finished_at = ?, output_text = ?, trace_json = ?, steps_used = ?, finish_reason = ?, input_tokens = ?, output_tokens = ?,
                 cached_input_tokens = ?, reasoning_tokens = ?, duration_ms = ?, provider_request_id = ?, observed_model = ?, truncated = ? WHERE id = ?`,
            )
            .bind(
              now,
              finalText,
              JSON.stringify(trace),
              ref.stepNo,
              outcome.finishReason,
              sumOrNull(all_.map((step) => step.inputTokens)),
              sumOrNull(all_.map((step) => step.outputTokens)),
              sumOrNull(all_.map((step) => step.cachedInputTokens)),
              sumOrNull(all_.map((step) => step.reasoningTokens)),
              sumOrNull(all_.map((step) => step.durationMs)),
              outcome.providerRequestId,
              outcome.observedModel,
              outcome.truncated ? 1 : 0,
              ref.attemptId,
            ),
          ...(checks ? [insertTestimonyChecksStatement(db, { id: deps.newId(), runId: ref.runId, caseKey: ref.caseKey, configurationKey: ref.configurationKey, attemptId: ref.attemptId, ...checks }, now)] : []),
          db.prepare(`UPDATE generations SET status = 'succeeded', accepted_attempt_id = ?, last_error_code = NULL, updated_at = ? WHERE id = ?`).bind(ref.attemptId, now, ref.generationId),
          // Calls a party did not need go back to the allowance.
          ...laterUnits,
          dropReplayStatement(db, ref.attemptId),
          ...terminalOutboxes,
          touchRunStatement(db, ref.runId, now),
          auditStatement(db, { eventType: 'attempt.complete', requestId: ref.requestId, outcome: 'succeeded', runId: ref.runId, metadata: { generationId: ref.generationId, attemptNo: ref.attemptNo, steps: ref.stepNo, ended, truncated: outcome.truncated } }, now),
        ])
        result = 'succeeded'
        opened = true
      } else {
        // The call was made and may be billed; the trace cannot be stored. Definite, never sent again.
        result = await commitFailure(deps, ref, { kind: 'failure', code: 'TOOL_TRACE_TOO_LARGE', definite: true, providerRequestId: outcome.providerRequestId, durationMs: outcome.durationMs }, false, current, laterUnits, terminalOutboxes, now)
      }
    } else {
      const failure = outcome.kind === 'failure' ? outcome : ({ kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, providerRequestId: outcome.providerRequestId, durationMs: outcome.durationMs } as const)
      result = await commitFailure(deps, ref, failure, unsent && outcome.kind === 'failure', current, laterUnits, terminalOutboxes, now)
    }
  } catch (error) {
    if (error instanceof GuardFailed) {
      // Canceled, deleted, lease-expired, or revoked meanwhile: evidence is unchanged.
      deps.log({ event: 'step.stale_commit_rejected', generationId: ref.generationId, attemptNo: ref.attemptNo, stepNo: ref.stepNo })
      // D-105: a step refused before its send (no history, an unusable key, an oversized body) that was
      // fenced meanwhile was still never sent, so its unit goes back like a step fenced before the send.
      if (unsent) await closeFencedStep(deps, ref)
      return 'stale'
    }
    throw error
  }
  if (opened) {
    try {
      await autoOpenReview(deps, ref.runId, ref.requestId)
    } catch {
      deps.log({ event: 'review.auto_open_failed', runId: ref.runId })
    }
  }
  await notifyRun(deps, ref.runId)
  return result
}

/**
 * A definite failure, an uncertain outcome or a pre-send failure at step k ends the attempt: step k+1
 * is never sent (its request would need step k's answer), so every later unit is released; step
 * k's own unit is released only when it was provably never sent.
 */
async function commitFailure(
  deps: Deps,
  ref: StepRef,
  outcome: Extract<ToolStepOutcome, { kind: 'failure' }>,
  unsent: boolean,
  current: Condition,
  laterUnits: D1PreparedStatement[],
  terminalOutboxes: D1PreparedStatement[],
  now: number,
): Promise<JobOutcome> {
  const db = deps.db
  const status = outcome.definite ? 'failed' : 'uncertain'
  await runGuarded(db, 'tool.step_fail', current, [
    ...(unsent ? releaseSteps(db, ref.generationId, ref.attemptNo, { at: ref.stepNo }, 'consumed', now) : []),
    ...laterUnits,
    db.prepare(`UPDATE generation_steps SET status = ?, finished_at = ?, error_code = ?, duration_ms = ?, provider_request_id = ? WHERE id = ?`).bind(status, now, outcome.code, outcome.durationMs, outcome.providerRequestId, ref.stepId),
    db.prepare(`UPDATE generation_attempts SET status = ?, finished_at = ?, error_code = ?, steps_used = ? WHERE id = ?`).bind(status, now, outcome.code, unsent ? ref.stepNo - 1 : ref.stepNo, ref.attemptId),
    db.prepare(`UPDATE generations SET status = ?, last_error_code = ?, updated_at = ? WHERE id = ?`).bind(status, outcome.code, now, ref.generationId),
    dropReplayStatement(db, ref.attemptId),
    ...terminalOutboxes,
    touchRunStatement(db, ref.runId, now),
    auditStatement(db, { eventType: 'attempt.complete', requestId: ref.requestId, outcome: status, runId: ref.runId, metadata: { generationId: ref.generationId, attemptNo: ref.attemptNo, stepNo: ref.stepNo, code: outcome.code } }, now),
  ])
  return outcome.definite ? 'failed' : 'uncertain'
}

// ---------------------------------------------------------------------------
// Dispatch and leases (cron and owner reads). Never contacts a provider.
// ---------------------------------------------------------------------------

const BACKOFF_MS = [5_000, 30_000, 60_000]
const UNCLAIMED_REDISPATCH_MS = 5 * 60_000

/** step_outbox → JobRoom, as `dispatchOutbox`. A crash between a step's commit and its enqueue loses nothing. */
export async function dispatchStepOutbox(deps: Deps, runId?: string): Promise<number> {
  const now = deps.now()
  const rows = await deps.db
    .prepare(
      `SELECT o.id, o.step_id, o.generation_id, o.dispatch_count, s.attempt_no, s.step_no FROM step_outbox o
       JOIN generation_steps s ON s.id = o.step_id JOIN generations g ON g.id = o.generation_id
       WHERE (? IS NULL OR g.run_id = ?)
         AND ((o.status = 'pending' AND o.next_dispatch_at <= ?) OR (o.status = 'dispatched' AND o.updated_at <= ?))
       ORDER BY o.created_at LIMIT 50`,
    )
    .bind(runId ?? null, runId ?? null, now, now - UNCLAIMED_REDISPATCH_MS)
    .all<{ id: string; step_id: string; generation_id: string; dispatch_count: number; attempt_no: number; step_no: number }>()
  let dispatched = 0
  for (const row of rows.results) {
    try {
      const jobId = await deps.enqueueToolStep({ stepOutboxId: row.id, stepId: row.step_id, generationId: row.generation_id, attemptNo: row.attempt_no, stepNo: row.step_no })
      await deps.db
        .prepare(`UPDATE step_outbox SET status = 'dispatched', job_id = ?, dispatch_count = dispatch_count + 1, updated_at = ? WHERE id = ? AND status IN ('pending','dispatched')`)
        .bind(jobId, now, row.id)
        .run()
      dispatched++
    } catch {
      const delay = BACKOFF_MS[Math.min(row.dispatch_count, BACKOFF_MS.length - 1)]
      await deps.db
        .prepare(`UPDATE step_outbox SET dispatch_count = dispatch_count + 1, next_dispatch_at = ?, last_error_code = 'ENQUEUE_FAILED', updated_at = ? WHERE id = ? AND status = 'pending'`)
        .bind(now + delay, now, row.id)
        .run()
      deps.log({ event: 'step_outbox.enqueue_failed', stepOutboxId: row.id })
    }
  }
  return dispatched
}

/**
 * A step whose lease ran out mid-call (spec 06 §7.6): its send cannot be proven absent, so its unit
 * stays consumed and the attempt is uncertain; later steps were never sent and are released.
 */
export async function reconcileStepLeases(deps: Deps, runId?: string): Promise<number> {
  const db = deps.db
  const now = deps.now()
  const expired = await db
    .prepare(
      `SELECT s.id, s.fence_token, s.attempt_id, s.generation_id, s.attempt_no, s.step_no, g.run_id FROM generation_steps s JOIN generations g ON g.id = s.generation_id
       WHERE s.status = 'running' AND s.deadline_at <= ? AND (? IS NULL OR g.run_id = ?) LIMIT 50`,
    )
    .bind(now, runId ?? null, runId ?? null)
    .all<{ id: string; fence_token: string; attempt_id: string; generation_id: string; attempt_no: number; step_no: number; run_id: string }>()
  let count = 0
  for (const step of expired.results) {
    try {
      await runGuarded(db, 'tool.step_lease_expired', cond(`EXISTS (SELECT 1 FROM generation_steps WHERE id = ? AND fence_token = ? AND status = 'running' AND deadline_at <= ?)`, step.id, step.fence_token, now), [
        ...releaseSteps(db, step.generation_id, step.attempt_no, { after: step.step_no }, 'reserved', now),
        db.prepare(`UPDATE generation_steps SET status = 'uncertain', error_code = 'PROVIDER_LEASE_EXPIRED', finished_at = ? WHERE id = ?`).bind(now, step.id),
        db.prepare(`UPDATE generation_attempts SET status = 'uncertain', error_code = 'PROVIDER_LEASE_EXPIRED', finished_at = ?, steps_used = ? WHERE id = ? AND status = 'running'`).bind(now, step.step_no, step.attempt_id),
        db.prepare(`UPDATE generations SET status = 'uncertain', last_error_code = 'PROVIDER_LEASE_EXPIRED', updated_at = ? WHERE id = ? AND status = 'running'`).bind(now, step.generation_id),
        dropReplayStatement(db, step.attempt_id),
        db.prepare(`UPDATE step_outbox SET status = 'terminal', updated_at = ? WHERE step_id = ?`).bind(now, step.id),
        db.prepare(`UPDATE outbox SET status = 'terminal', updated_at = ? WHERE generation_id = ? AND attempt_no = ?`).bind(now, step.generation_id, step.attempt_no),
        touchRunStatement(db, step.run_id, now),
      ])
      count++
      await notifyRun(deps, step.run_id)
    } catch (error) {
      if (!(error instanceof GuardFailed)) throw error
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Admission, retry, cancel, delete and revoke (spec 06 §7.1, §7.7, §7.8)
// ---------------------------------------------------------------------------

/**
 * `maxSteps` reserved units for one attempt of a tool generation, in one statement (a recursive
 * CTE, so a 6-step reservation binds seven values, not 42).
 */
export function reserveStepsStatement(db: D1Database, args: { generationId: string; attemptNo: number; steps: number; subjects: { actor: string; global: string; lifetime: string; windowStart: number }; now: number }): D1PreparedStatement {
  return db
    .prepare(
      `WITH RECURSIVE n(step_no) AS (SELECT 1 UNION ALL SELECT step_no + 1 FROM n WHERE step_no < ?)
       INSERT INTO step_reservations (generation_id, attempt_no, step_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at)
       SELECT ?, ?, step_no, ?, ?, ?, ?, 'reserved', ? FROM n`,
    )
    .bind(args.steps, args.generationId, args.attemptNo, args.subjects.actor, args.subjects.global, args.subjects.lifetime, args.subjects.windowStart, args.now)
}

/**
 * Statements that stop the tool loops among `generationsSql` (a SELECT of generation ids, bound to
 * `binds`), in the batch of a cancel, a delete or a revocation: reserved units of unclaimed steps
 * released; queued steps closed; their outbox rows terminal; replay data dropped. In-flight steps
 * become `inFlight` (`canceled` for cancel and delete, `uncertain` for revocation), since a call
 * may still be billed and will be fenced out.
 */
export function stopToolLoopsStatements(db: D1Database, generationsSql: string, binds: unknown[], code: string, inFlight: 'canceled' | 'uncertain', now: number): D1PreparedStatement[] {
  return [
    ...releaseReservations(db, cond(`r.generation_id IN (${generationsSql})`, ...binds), 'reserved', now, 'step_reservations'),
    db.prepare(`UPDATE step_outbox SET status = 'terminal', last_error_code = ?, updated_at = ? WHERE status IN ('pending','dispatched') AND generation_id IN (${generationsSql})`).bind(code, now, ...binds),
    db.prepare(`UPDATE generation_steps SET status = 'canceled', error_code = ?, finished_at = ? WHERE status = 'pending' AND generation_id IN (${generationsSql})`).bind(code, now, ...binds),
    db.prepare(`UPDATE generation_steps SET status = ?, error_code = ?, finished_at = ? WHERE status = 'running' AND generation_id IN (${generationsSql})`).bind(inFlight, code, now, ...binds),
    db.prepare(`UPDATE generation_steps SET replay_json = NULL WHERE replay_json IS NOT NULL AND status NOT IN ('pending','running') AND generation_id IN (${generationsSql})`).bind(...binds),
  ]
}

/**
 * Revocation (spec 06 §7.7): a tool generation waiting between steps had nothing in flight, so it
 * fails with CREDENTIAL_REVOKED instead of becoming uncertain. Put these before the step and the
 * generic attempt updates of `revokeCredentialStatements`.
 */
export function revokeIdleToolLoopsStatements(db: D1Database, generationsSql: string, binds: unknown[], now: number): D1PreparedStatement[] {
  const idle = `a.kind = 'tool_loop' AND a.status = 'running' AND NOT EXISTS (SELECT 1 FROM generation_steps s WHERE s.attempt_id = a.id AND s.status = 'running')`
  return [
    db
      .prepare(`UPDATE generations SET status = 'failed', last_error_code = 'CREDENTIAL_REVOKED', updated_at = ? WHERE status = 'running' AND id IN (${generationsSql}) AND EXISTS (SELECT 1 FROM generation_attempts a WHERE a.generation_id = generations.id AND ${idle})`)
      .bind(now, ...binds),
    db.prepare(`UPDATE generation_attempts SET status = 'failed', error_code = 'CREDENTIAL_REVOKED', finished_at = ? WHERE id IN (SELECT a.id FROM generation_attempts a WHERE ${idle} AND a.generation_id IN (${generationsSql}))`).bind(now, ...binds),
  ]
}
