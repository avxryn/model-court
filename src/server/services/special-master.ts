/**
 * The special master (D-40): an advisory AI grader, billed to the judge's own
 * key, that runs only after the record is unsealed and is visible only to the
 * judge. Its scores live in their own tables and never enter the jury's
 * findings, the disagreements, or the judgment. The paid-call shape mirrors
 * generation: outbox → job → guarded claim with a fence → send outside a
 * transaction → fenced commit; no automatic paid retry.
 */

import type { z } from 'zod'
import { calibrate, type CalibrationItem } from '../../domain/calibration'
import { canonicalJson, sha256Hex } from '../../domain/canonical'
import type { startSpecialMasterSchema } from '../../domain/contracts'
import { buildGraderRequest, buildGroundedGraderRequest, GRADER_TEMPLATE_VERSION, GROUNDED_GRADER_TEMPLATE_VERSION, parseGraderOutput, type GraderTemplateVersion } from '../../domain/grader'
import type { GroundedFields } from '../../domain/kits/grounded'
import { loadRunPromptSources, sourceRefsOf } from './sources'
import { LIMITS } from '../../domain/limits'
import { findRoute, isRouteEnabled, type ProviderId } from '../../domain/registry'
import { DIMENSIONS, rubricLines } from '../../domain/rubric'
import { isImportedSnapshot } from '../../domain/snapshot'
import { loadRunAccess } from '../access'
import { all, auditStatement, budgetSubjects, classifyConstraint, cond, GuardFailed, releaseReservations, reserveBudget, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, notFound, stateConflict } from '../http'
import { adapterFor, type ProviderOutcome } from '../providers'
import { idempotent, requestHash } from '../receipts'
import { CredentialUnusable, withGraderCredential } from './credentials'
import { getResults } from './results'
import { parseSnapshot, type EligibleManifest } from './runs'

export const GRADING_JOB_TYPE = 'mc.grade'
export interface GradingJob {
  outboxId: string
  graderItemId: string
  attemptNo: number
}

/** At most three grader runs per hearing, so a judge can compare graders without unbounded spend. */
export const MAX_GRADER_RUNS_PER_HEARING = 3

interface GraderConfig {
  modelKey: string
  provider: ProviderId
  modelId: string
  adapterVersion: string
  /** Spec 05 (D-97): `grader-grounded-v1` on grounded hearings. */
  graderTemplateVersion: GraderTemplateVersion
  rubricVersion: string
}

function touchGraderRun(db: D1Database, graderRunId: string, now: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE grader_runs SET revision = revision + 1, updated_at = ?,
         status = CASE WHEN status = 'generating' AND NOT EXISTS (
           SELECT 1 FROM grader_items i WHERE i.grader_run_id = grader_runs.id AND i.status IN ('pending','running')) THEN 'ready' ELSE status END
       WHERE id = ?`,
    )
    .bind(now, graderRunId)
}

function requireJudge(access: { role: string }): void {
  // Jurors get the same answer as strangers: the special master does not exist for them.
  if (access.role !== 'owner') throw notFound()
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export const SPECIAL_MASTER_EXTRACTION_TEXT = "The AI grader isn't available for field-extraction cases yet."
/** Spec 06 open question 9 (D-102): no grader reads tool traces yet. */
export const SPECIAL_MASTER_TOOLS_TEXT = "The AI grader isn't available for tool-use cases yet."

export async function startSpecialMaster(deps: Deps, userId: string, runId: string, input: z.output<typeof startSpecialMasterSchema>, key: string, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireJudge(access)
  if (!deps.config.generationEnabled) throw new ApiError(503, 'GENERATION_DISABLED', 'Live generation is disabled on this deployment.')
  const run = access.run
  if (run.status !== 'revealed' && run.status !== 'decided') throw stateConflict('The special master can grade only after the record is unsealed.')
  // Spec 04 decision 8 (D-87): no grader for field-extraction hearings yet.
  if (parseSnapshot(run.snapshot_json).kit?.version === 'extraction-v1') throw stateConflict(SPECIAL_MASTER_EXTRACTION_TEXT, { reason: 'kit_unsupported' })
  if (parseSnapshot(run.snapshot_json).kit?.version === 'tools-v1') throw stateConflict(SPECIAL_MASTER_TOOLS_TEXT, { reason: 'kit_unsupported' })
  const route = findRoute(input.modelKey, deps.routes)
  if (!route || !isRouteEnabled(route)) throw new ApiError(422, 'UNSUPPORTED_CONFIGURATION', 'Choose a verified model for the special master.')
  const supplied = Object.keys(input.credentialIdsByProvider)
  if (supplied.length !== 1 || supplied[0] !== route.provider) {
    throw new ApiError(422, 'CREDENTIAL_MISSING', 'Provide exactly one saved key for the grader’s provider.', { details: { requiredProviders: [route.provider] } })
  }
  const credentialId = input.credentialIdsByProvider[route.provider]!
  const db = deps.db
  const operation = `grader.start:${runId}`
  const hash = await requestHash(operation, input)

  const result = await idempotent(deps, { actorUserId: userId, idempotencyKey: key, operation, requestHash: hash }, async (receipt) => {
    const snapshot = parseSnapshot(run.snapshot_json)
    const manifest = JSON.parse(run.eligible_manifest_json ?? '{"caseKeys":[],"excludedCaseKeys":[],"entries":[]}') as EligibleManifest
    if (manifest.entries.length === 0) throw stateConflict('There is nothing eligible to grade.')
    const config: GraderConfig = { modelKey: route.key, provider: route.provider, modelId: route.modelId, adapterVersion: route.adapterVersion, graderTemplateVersion: snapshot.kit?.version === 'grounded-v1' ? GROUNDED_GRADER_TEMPLATE_VERSION : GRADER_TEMPLATE_VERSION, rubricVersion: snapshot.rubricVersion }
    const configHash = await sha256Hex(canonicalJson(config))
    const now = deps.now()
    const graderRunId = deps.newId()
    const subjects = budgetSubjects(userId, now)
    const items = manifest.entries.map((entry) => ({ id: deps.newId(), outboxId: deps.newId(), caseKey: entry.caseKey, configurationKey: entry.configurationKey }))
    const response = { status: 202 as const, data: { graderRunId, status: 'generating' as const, plannedCalls: items.length } }
    const statements: D1PreparedStatement[] = [
      receipt(response, graderRunId),
      db
        .prepare(`INSERT INTO grader_runs (id, run_id, owner_user_id, status, config_json, config_hash, revision, created_at, updated_at) VALUES (?, ?, ?, 'generating', ?, ?, 1, ?, ?)`)
        .bind(graderRunId, runId, userId, JSON.stringify(config), configHash, now, now),
      db.prepare('INSERT INTO grader_credentials (grader_run_id, provider, credential_id) VALUES (?, ?, ?)').bind(graderRunId, route.provider, credentialId),
      ...reserveBudget(db, subjects, items.length, deps.config.limits, now),
      ...items.flatMap((item) => [
        db
          .prepare(`INSERT INTO grader_items (id, grader_run_id, case_key, configuration_key, status, attempt_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 1, ?, ?)`)
          .bind(item.id, graderRunId, item.caseKey, item.configurationKey, now, now),
        db
          .prepare(
            `INSERT INTO grader_reservations (grader_item_id, attempt_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at) VALUES (?, 1, ?, ?, ?, ?, 'reserved', ?)`,
          )
          .bind(item.id, subjects.actor, subjects.global, subjects.lifetime, subjects.windowStart, now),
        db.prepare(`INSERT INTO grader_outbox (id, grader_item_id, attempt_no, status, next_dispatch_at, created_at, updated_at) VALUES (?, ?, 1, 'pending', ?, ?, ?)`).bind(item.outboxId, item.id, now, now, now),
      ]),
      auditStatement(db, { eventType: 'grader.start', requestId, outcome: 'ok', actorUserId: userId, runId, evaluationId: run.evaluation_id, metadata: { graderRunId, plannedCalls: items.length, provider: route.provider } }, now),
    ]
    try {
      await runGuarded(
        db,
        'grader.start',
        all(
          cond(`EXISTS (SELECT 1 FROM runs r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = ? AND r.owner_user_id = ? AND r.status IN ('revealed','decided') AND e.deleted_at IS NULL)`, runId, userId),
          cond(
            `EXISTS (SELECT 1 FROM provider_credentials WHERE id = ? AND owner_user_id = ? AND provider = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?))`,
            credentialId,
            userId,
            route.provider,
            now,
          ),
          cond(`(SELECT COUNT(*) FROM grader_runs WHERE run_id = ?) < ${MAX_GRADER_RUNS_PER_HEARING}`, runId),
          cond(`NOT EXISTS (SELECT 1 FROM grader_runs WHERE run_id = ? AND status = 'generating')`, runId),
        ),
        statements,
      )
    } catch (error) {
      if (error instanceof GuardFailed) {
        const count = (await db.prepare('SELECT COUNT(*) AS n FROM grader_runs WHERE run_id = ?').bind(runId).first<{ n: number }>())?.n ?? 0
        if (count >= MAX_GRADER_RUNS_PER_HEARING) throw stateConflict(`A hearing can have at most ${MAX_GRADER_RUNS_PER_HEARING} special-master runs.`)
        const active = await db.prepare(`SELECT 1 AS ok FROM grader_runs WHERE run_id = ? AND status = 'generating'`).bind(runId).first()
        if (active) throw stateConflict('A special-master run is already in progress for this hearing.')
        throw new ApiError(422, 'CREDENTIAL_MISSING', 'The selected key is missing, expired, revoked, or not yours. Add or renew a key in Settings.')
      }
      if (classifyConstraint(error) === 'budget') throw new ApiError(429, 'QUOTA_EXHAUSTED', 'The provider-call limit for today (or for this deployment) has been reached.')
      throw error
    }
    return response
  })

  if (!result.replayed) await dispatchGraderOutbox(deps, (result.data as { graderRunId: string }).graderRunId)
  return result
}

// ---------------------------------------------------------------------------
// Dispatch, claim, send, commit
// ---------------------------------------------------------------------------

const BACKOFF_MS = [5_000, 30_000, 60_000]
const UNCLAIMED_REDISPATCH_MS = 5 * 60_000

export async function dispatchGraderOutbox(deps: Deps, graderRunId?: string): Promise<number> {
  const now = deps.now()
  const rows = await deps.db
    .prepare(
      `SELECT o.id, o.grader_item_id, o.attempt_no, o.dispatch_count FROM grader_outbox o JOIN grader_items i ON i.id = o.grader_item_id
       WHERE (? IS NULL OR i.grader_run_id = ?)
         AND ((o.status = 'pending' AND o.next_dispatch_at <= ?) OR (o.status = 'dispatched' AND o.updated_at <= ?))
       ORDER BY o.created_at LIMIT 50`,
    )
    .bind(graderRunId ?? null, graderRunId ?? null, now, now - UNCLAIMED_REDISPATCH_MS)
    .all<{ id: string; grader_item_id: string; attempt_no: number; dispatch_count: number }>()
  let dispatched = 0
  for (const row of rows.results) {
    try {
      const jobId = await deps.enqueueGrading({ outboxId: row.id, graderItemId: row.grader_item_id, attemptNo: row.attempt_no })
      await deps.db.prepare(`UPDATE grader_outbox SET status = 'dispatched', job_id = ?, dispatch_count = dispatch_count + 1, updated_at = ? WHERE id = ? AND status IN ('pending','dispatched')`).bind(jobId, now, row.id).run()
      dispatched++
    } catch {
      const delay = BACKOFF_MS[Math.min(row.dispatch_count, BACKOFF_MS.length - 1)]
      await deps.db
        .prepare(`UPDATE grader_outbox SET dispatch_count = dispatch_count + 1, next_dispatch_at = ?, last_error_code = 'ENQUEUE_FAILED', updated_at = ? WHERE id = ? AND status = 'pending'`)
        .bind(now + delay, now, row.id)
        .run()
      deps.log({ event: 'grader_outbox.enqueue_failed', outboxId: row.id })
    }
  }
  return dispatched
}

interface GradingContext {
  graderRunId: string
  runId: string
  caseKey: string
  configurationKey: string
  config: GraderConfig
  snapshotJson: string
  manifestJson: string | null
}

export type GradingOutcome = 'not_claimed' | 'succeeded' | 'failed' | 'uncertain' | 'stale'

export async function handleGradingJob(deps: Deps, job: GradingJob, jobSignal: AbortSignal, requestId: string): Promise<GradingOutcome> {
  const db = deps.db
  const row = await db
    .prepare(
      `SELECT i.grader_run_id, i.case_key, i.configuration_key, g.run_id, g.config_json, r.snapshot_json, r.eligible_manifest_json
       FROM grader_items i JOIN grader_runs g ON g.id = i.grader_run_id JOIN runs r ON r.id = g.run_id
       JOIN grader_outbox o ON o.grader_item_id = i.id AND o.attempt_no = ?
       WHERE i.id = ? AND o.id = ?`,
    )
    .bind(job.attemptNo, job.graderItemId, job.outboxId)
    .first<{ grader_run_id: string; case_key: string; configuration_key: string; run_id: string; config_json: string; snapshot_json: string; eligible_manifest_json: string | null }>()
  if (!row) return 'not_claimed'
  const context: GradingContext = {
    graderRunId: row.grader_run_id,
    runId: row.run_id,
    caseKey: row.case_key,
    configurationKey: row.configuration_key,
    config: JSON.parse(row.config_json) as GraderConfig,
    snapshotJson: row.snapshot_json,
    manifestJson: row.eligible_manifest_json,
  }

  const claimedAt = deps.now()
  const attemptId = deps.newId()
  const fence = deps.newId()
  try {
    await runGuarded(
      db,
      'grader.claim',
      all(
        cond(`EXISTS (SELECT 1 FROM grader_items WHERE id = ? AND status = 'pending' AND attempt_count = ?)`, job.graderItemId, job.attemptNo),
        cond(
          `EXISTS (SELECT 1 FROM grader_runs g JOIN runs r ON r.id = g.run_id JOIN evaluations e ON e.id = r.evaluation_id WHERE g.id = ? AND g.status = 'generating' AND e.deleted_at IS NULL)`,
          context.graderRunId,
        ),
        cond(`EXISTS (SELECT 1 FROM grader_reservations WHERE grader_item_id = ? AND attempt_no = ? AND state = 'reserved')`, job.graderItemId, job.attemptNo),
      ),
      [
        db.prepare(`UPDATE grader_items SET status = 'running', updated_at = ? WHERE id = ?`).bind(claimedAt, job.graderItemId),
        db
          .prepare(`INSERT INTO grader_attempts (id, grader_item_id, attempt_no, fence_token, status, started_at, deadline_at) VALUES (?, ?, ?, ?, 'running', ?, ?)`)
          .bind(attemptId, job.graderItemId, job.attemptNo, fence, claimedAt, claimedAt + LIMITS.attemptLeaseMs),
        db.prepare(`UPDATE grader_reservations SET state = 'consumed' WHERE grader_item_id = ? AND attempt_no = ? AND state = 'reserved'`).bind(job.graderItemId, job.attemptNo),
        db.prepare(`UPDATE grader_outbox SET status = 'claimed', updated_at = ? WHERE id = ?`).bind(claimedAt, job.outboxId),
        touchGraderRun(db, context.graderRunId, claimedAt),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) return 'not_claimed'
    throw error
  }

  const unsentFailure = (code: string): ProviderOutcome => ({ kind: 'failure', code: code as never, definite: true, providerRequestId: null, durationMs: 0 })
  const text = await responseText(db, context)
  const snapshot = parseSnapshot(context.snapshotJson)
  const testCase = snapshot.cases.find((c) => c.key === context.caseKey)
  const adapter = adapterFor(context.config.adapterVersion, context.config.provider, 1)
  if (text === null || !testCase || !adapter) return finishGrading(deps, { attemptId, fence, job, context, requestId }, unsentFailure('INVALID_PROVIDER_RESPONSE'), true)

  // Spec 05 (D-97): a grounded question is graded against its frozen sources, verified like generation's.
  let request: ReturnType<typeof buildGraderRequest>
  if (context.config.graderTemplateVersion === GROUNDED_GRADER_TEMPLATE_VERSION) {
    const sources = await loadRunPromptSources(db, context.runId, testCase.key, sourceRefsOf(testCase))
    if (!sources) {
      deps.log({ event: 'grader.sources_mismatch', graderItemId: job.graderItemId, attemptNo: job.attemptNo })
      return finishGrading(deps, { attemptId, fence, job, context, requestId }, unsentFailure('INVALID_PROVIDER_RESPONSE'), true)
    }
    const fields = testCase.kitFields as GroundedFields | undefined
    request = buildGroundedGraderRequest(rubricLines(context.config.rubricVersion), {
      input: testCase.input,
      sources,
      groundingKey: { answerable: fields?.answerable ?? 'yes', requiredSources: fields?.requiredSources ?? [] },
      expectedBehavior: testCase.expectedBehavior,
      response: text,
    })
  } else {
    request = buildGraderRequest(rubricLines(context.config.rubricVersion), {
      input: testCase.input,
      reference: testCase.reference,
      expectedBehavior: testCase.expectedBehavior,
      messages: testCase.messages,
      response: text,
    })
  }
  const timeout = AbortSignal.timeout(deps.config.providerTimeoutMs)
  const signal = AbortSignal.any([jobSignal, timeout])
  let outcome: ProviderOutcome
  let unsent = false
  try {
    outcome = await withGraderCredential(deps, context.graderRunId, context.config.provider, requestId, async (apiKey) => {
      if (!(await graderAttemptCurrent(db, attemptId, fence, context.graderRunId))) throw new GraderFenced()
      return adapter(deps.providerFetch, { modelId: context.config.modelId, system: request.system, messages: request.messages, maxOutputTokens: LIMITS.maxOutputTokens, apiKey, signal }, timeout)
    })
    // Spec 07 §6.5: refused by the outbound allowlist before any send.
    if (outcome.kind === 'failure' && outcome.unsent) unsent = true
  } catch (error) {
    if (error instanceof GraderFenced) {
      // Canceled or deleted before the send: provably unsent, so the unit goes back.
      await releaseFenced(deps, attemptId, fence, job)
      return 'stale'
    }
    if (error instanceof CredentialUnusable) {
      unsent = true
      outcome = unsentFailure(error.code)
    } else {
      outcome = { kind: 'failure', code: 'PROVIDER_NETWORK_ERROR', definite: false, providerRequestId: null, durationMs: 0 }
    }
  }
  return finishGrading(deps, { attemptId, fence, job, context, requestId }, outcome, unsent)
}

class GraderFenced extends Error {}

async function releaseFenced(deps: Deps, attemptId: string, fence: string, job: GradingJob): Promise<void> {
  const now = deps.now()
  try {
    await runGuarded(deps.db, 'grader.fenced', cond(`EXISTS (SELECT 1 FROM grader_attempts WHERE id = ? AND fence_token = ? AND status = 'running')`, attemptId, fence), [
      ...releaseReservations(deps.db, cond('r.grader_item_id = ? AND r.attempt_no = ?', job.graderItemId, job.attemptNo), 'consumed', now, 'grader_reservations'),
      deps.db.prepare(`UPDATE grader_attempts SET status = 'failed', error_code = 'CANCELED', finished_at = ? WHERE id = ?`).bind(now, attemptId),
    ])
  } catch (error) {
    if (!(error instanceof GuardFailed)) throw error
  }
}

async function graderAttemptCurrent(db: D1Database, attemptId: string, fence: string, graderRunId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM grader_attempts a JOIN grader_runs g ON g.id = ? JOIN runs r ON r.id = g.run_id JOIN evaluations e ON e.id = r.evaluation_id
       WHERE a.id = ? AND a.fence_token = ? AND a.status = 'running' AND g.status = 'generating' AND e.deleted_at IS NULL`,
    )
    .bind(graderRunId, attemptId, fence)
    .first()
  return !!row
}

/** The accepted text for one (question, party) from the frozen manifest: a generated attempt or an imported answer. */
async function responseText(db: D1Database, context: GradingContext): Promise<string | null> {
  const manifest = JSON.parse(context.manifestJson ?? '{"entries":[]}') as EligibleManifest
  const entry = manifest.entries.find((e) => e.caseKey === context.caseKey && e.configurationKey === context.configurationKey)
  if (!entry) return null
  if (entry.importedOutputId) {
    return (await db.prepare('SELECT text FROM run_imported_outputs WHERE id = ? AND run_id = ?').bind(entry.importedOutputId, context.runId).first<{ text: string }>())?.text ?? null
  }
  if (!entry.acceptedAttemptId) return null
  return (await db.prepare(`SELECT output_text FROM generation_attempts WHERE id = ? AND status = 'succeeded'`).bind(entry.acceptedAttemptId).first<{ output_text: string }>())?.output_text ?? null
}

interface GradingRef {
  attemptId: string
  fence: string
  job: GradingJob
  context: GradingContext
  requestId: string
}

async function finishGrading(deps: Deps, ref: GradingRef, outcome: ProviderOutcome, unsent: boolean): Promise<GradingOutcome> {
  const db = deps.db
  const now = deps.now()
  const { job, context } = ref
  const current = all(
    cond(`EXISTS (SELECT 1 FROM grader_attempts WHERE id = ? AND fence_token = ? AND status = 'running')`, ref.attemptId, ref.fence),
    cond(`EXISTS (SELECT 1 FROM grader_runs WHERE id = ? AND status = 'generating')`, context.graderRunId),
    // Like hearings: output that arrives after the judge removed the key is not accepted.
    ...(outcome.kind === 'success'
      ? [cond(`EXISTS (SELECT 1 FROM grader_credentials gc JOIN provider_credentials c ON c.id = gc.credential_id WHERE gc.grader_run_id = ? AND c.status = 'active')`, context.graderRunId)]
      : []),
  )
  const terminalOutbox = db.prepare(`UPDATE grader_outbox SET status = 'terminal', updated_at = ? WHERE id = ?`).bind(now, job.outboxId)
  // Malformed grader output was sent and possibly billed: a definite failure, never retried automatically.
  const parsed = outcome.kind === 'success' ? parseGraderOutput(outcome.text) : null
  const status = outcome.kind === 'success' ? (parsed ? 'succeeded' : 'failed') : outcome.definite ? 'failed' : 'uncertain'
  const errorCode = outcome.kind === 'success' ? (parsed ? null : 'GRADER_INVALID_OUTPUT') : outcome.code
  try {
    await runGuarded(db, 'grader.complete', current, [
      ...(unsent ? releaseReservations(db, cond('r.grader_item_id = ? AND r.attempt_no = ?', job.graderItemId, job.attemptNo), 'consumed', now, 'grader_reservations') : []),
      db
        .prepare(
          `UPDATE grader_attempts SET status = ?, finished_at = ?, output_text = ?, parsed_json = ?, error_code = ?, input_tokens = ?, output_tokens = ?, duration_ms = ?, provider_request_id = ? WHERE id = ?`,
        )
        .bind(
          status,
          now,
          outcome.kind === 'success' ? outcome.text : null,
          parsed ? JSON.stringify(parsed) : null,
          errorCode,
          outcome.kind === 'success' ? outcome.inputTokens : null,
          outcome.kind === 'success' ? outcome.outputTokens : null,
          outcome.durationMs,
          outcome.providerRequestId,
          ref.attemptId,
        ),
      db
        .prepare(`UPDATE grader_items SET status = ?, accepted_attempt_id = ?, last_error_code = ?, updated_at = ? WHERE id = ?`)
        .bind(status, status === 'succeeded' ? ref.attemptId : null, errorCode, now, job.graderItemId),
      terminalOutbox,
      touchGraderRun(db, context.graderRunId, now),
      auditStatement(db, { eventType: 'grader.complete', requestId: ref.requestId, outcome: status, runId: context.runId, metadata: { graderItemId: job.graderItemId, code: errorCode } }, now),
    ])
  } catch (error) {
    if (error instanceof GuardFailed) return 'stale'
    throw error
  }
  return status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'uncertain'
}

/** Cron: expire lost grader attempts as uncertain (the send cannot be proven absent). Never contacts a provider. */
export async function reconcileGraderLeases(deps: Deps): Promise<number> {
  const db = deps.db
  const now = deps.now()
  const expired = await db
    .prepare(
      `SELECT a.id, a.fence_token, a.grader_item_id, a.attempt_no, i.grader_run_id FROM grader_attempts a JOIN grader_items i ON i.id = a.grader_item_id
       WHERE a.status = 'running' AND a.deadline_at <= ? LIMIT 50`,
    )
    .bind(now)
    .all<{ id: string; fence_token: string; grader_item_id: string; attempt_no: number; grader_run_id: string }>()
  let count = 0
  for (const attempt of expired.results) {
    try {
      await runGuarded(db, 'grader.lease_expired', cond(`EXISTS (SELECT 1 FROM grader_attempts WHERE id = ? AND fence_token = ? AND status = 'running' AND deadline_at <= ?)`, attempt.id, attempt.fence_token, now), [
        db.prepare(`UPDATE grader_attempts SET status = 'uncertain', error_code = 'PROVIDER_LEASE_EXPIRED', finished_at = ? WHERE id = ?`).bind(now, attempt.id),
        db.prepare(`UPDATE grader_items SET status = 'uncertain', last_error_code = 'PROVIDER_LEASE_EXPIRED', updated_at = ? WHERE id = ? AND status = 'running'`).bind(now, attempt.grader_item_id),
        db.prepare(`UPDATE grader_outbox SET status = 'terminal', updated_at = ? WHERE grader_item_id = ? AND attempt_no = ?`).bind(now, attempt.grader_item_id, attempt.attempt_no),
        touchGraderRun(db, attempt.grader_run_id, now),
      ])
      count++
    } catch (error) {
      if (!(error instanceof GuardFailed)) throw error
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Cancel and read
// ---------------------------------------------------------------------------

export async function cancelSpecialMaster(deps: Deps, userId: string, runId: string, graderRunId: string, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireJudge(access)
  const db = deps.db
  const now = deps.now()
  const pending = `SELECT id FROM grader_items WHERE grader_run_id = ? AND status = 'pending'`
  try {
    await runGuarded(db, 'grader.cancel', cond(`EXISTS (SELECT 1 FROM grader_runs WHERE id = ? AND run_id = ? AND owner_user_id = ? AND status = 'generating')`, graderRunId, runId, userId), [
      // Queued calls were never sent: release their units. A call already in flight may still be billed; its result is discarded.
      ...releaseReservations(db, cond(`r.grader_item_id IN (${pending})`, graderRunId), 'reserved', now, 'grader_reservations'),
      db.prepare(`UPDATE grader_outbox SET status = 'terminal', last_error_code = 'CANCELED', updated_at = ? WHERE status IN ('pending','dispatched') AND grader_item_id IN (SELECT id FROM grader_items WHERE grader_run_id = ?)`).bind(now, graderRunId),
      db.prepare(`UPDATE grader_items SET status = 'canceled', last_error_code = 'CANCELED', updated_at = ? WHERE grader_run_id = ? AND status IN ('pending','running')`).bind(now, graderRunId),
      db.prepare(`UPDATE grader_runs SET status = 'canceled', revision = revision + 1, updated_at = ? WHERE id = ?`).bind(now, graderRunId),
      auditStatement(db, { eventType: 'grader.cancel', requestId, outcome: 'ok', actorUserId: userId, runId, metadata: { graderRunId } }, now),
    ])
  } catch (error) {
    if (error instanceof GuardFailed) throw stateConflict('Only a special-master run in progress can be canceled.')
    throw error
  }
  return { graderRunId, status: 'canceled' as const }
}

/** Owner-only. Calibration against the jury comes first; the grader's own totals follow. */
export async function getSpecialMaster(deps: Deps, userId: string, runId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireJudge(access)
  const run = access.run
  const unsealed = run.status === 'revealed' || run.status === 'decided'
  const graderRuns = (
    await deps.db.prepare('SELECT id, status, config_json, config_hash, created_at FROM grader_runs WHERE run_id = ? ORDER BY created_at, id').bind(runId).all<{ id: string; status: string; config_json: string; config_hash: string; created_at: number }>()
  ).results
  const results = unsealed ? await getResults(deps, userId, runId) : null
  const snapshot = parseSnapshot(run.snapshot_json)
  const partyProviders = new Set(snapshot.configurations.flatMap((c) => (isImportedSnapshot(c) ? [] : [c.provider])))
  const partyModels = new Set(snapshot.configurations.flatMap((c) => (isImportedSnapshot(c) ? [] : [c.modelId])))
  const jurorCount = results?.cohorts.invited.reviewerCount ?? 0

  const views = []
  for (const graderRun of graderRuns) {
    const config = JSON.parse(graderRun.config_json) as GraderConfig
    const items = (
      await deps.db
        .prepare(
          `SELECT i.id, i.case_key, i.configuration_key, i.status, i.last_error_code, a.parsed_json FROM grader_items i
           LEFT JOIN grader_attempts a ON a.id = i.accepted_attempt_id WHERE i.grader_run_id = ? ORDER BY i.created_at, i.id`,
        )
        .bind(graderRun.id)
        .all<{ id: string; case_key: string; configuration_key: string; status: string; last_error_code: string | null; parsed_json: string | null }>()
    ).results.map((item) => ({ caseKey: item.case_key, configurationKey: item.configuration_key, status: item.status, errorCode: item.last_error_code, scores: item.parsed_json ? (JSON.parse(item.parsed_json) as Record<string, number | string>) : null }))

    const calibrationItems: CalibrationItem[] = items.flatMap((item) => {
      if (!item.scores || !results) return []
      const testCase = results.cases.find((c) => c.key === item.caseKey)
      const jurors = (testCase?.judgments ?? [])
        .filter((j) => j.contextType === 'invited' && j.configurationKey === item.configurationKey && j.correctness !== null && j.completeness !== null && j.grounding !== null)
        .map((j) => ({ correctness: j.correctness!, completeness: j.completeness!, grounding: j.grounding! }))
      return [{ caseKey: item.caseKey, configurationKey: item.configurationKey, grader: { correctness: Number(item.scores.correctness), completeness: Number(item.scores.completeness), grounding: Number(item.scores.grounding), note: String(item.scores.note ?? '') }, jurors }]
    })
    const graded = items.filter((item) => item.scores)
    const totals = Object.fromEntries(
      snapshot.configurations.map((c) => {
        const mine = graded.filter((item) => item.configurationKey === c.key)
        const mean = (d: (typeof DIMENSIONS)[number]) => (mine.length ? mine.reduce((sum, item) => sum + Number(item.scores![d]), 0) / mine.length : null)
        return [c.key, { graded: mine.length, correctness: mean('correctness'), completeness: mean('completeness'), grounding: mean('grounding') }]
      }),
    ) as Record<string, { graded: number; correctness: number | null; completeness: number | null; grounding: number | null }>
    views.push({
      id: graderRun.id,
      status: graderRun.status,
      createdAt: graderRun.created_at,
      configHash: graderRun.config_hash,
      model: { key: config.modelKey, provider: config.provider, modelId: config.modelId },
      rubricVersion: config.rubricVersion,
      selfPreferenceRisk: partyModels.has(config.modelId) ? ('same_model' as const) : partyProviders.has(config.provider) ? ('same_provider' as const) : null,
      counts: {
        planned: items.length,
        succeeded: graded.length,
        failed: items.filter((i) => i.status === 'failed').length,
        uncertain: items.filter((i) => i.status === 'uncertain').length,
        canceled: items.filter((i) => i.status === 'canceled').length,
      },
      calibration: calibrate(calibrationItems, jurorCount),
      totals,
      items,
    })
  }
  return { runId, available: unsealed, maxRuns: MAX_GRADER_RUNS_PER_HEARING, graderRuns: views }
}
