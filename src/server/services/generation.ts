/**
 * Durable generation (F06, F07, F17, F27; spec §4.4, §10.2).
 *
 * outbox row → JobRoom job (IDs only) → conditional claim with a fresh fencing
 * token → owned-key provider call outside any transaction → commit only if the
 * fence, run state, deletion state, and credential are all still current.
 * No automatic paid retry exists anywhere in this module.
 */

import { LIMITS } from '../../domain/limits'
import { buildConversation, MESSAGE_TEMPLATE_VERSION } from '../../domain/messages'
import type { ProviderId } from '../../domain/registry'
import { isImportedSnapshot, type RunSnapshot } from '../../domain/snapshot'
import { all, auditStatement, cond, GuardFailed, releaseReservations, runGuarded } from '../db/sql'
import type { Deps, GenerationJob } from '../deps'
import { adapterFor, type ProviderOutcome } from '../providers'
import { attemptStillCurrent, CredentialUnusable, withRunCredential } from './credentials'

class AttemptFenced extends Error {}

export const GENERATION_JOB_TYPE = 'mc.generate'

/** Bump run revision and move generating → ready once no generation is pending/running. */
export function touchRunStatement(db: D1Database, runId: string, now: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE runs SET revision = revision + 1, updated_at = ?,
         status = CASE WHEN status = 'generating' AND NOT EXISTS (
           SELECT 1 FROM generations g WHERE g.run_id = runs.id AND g.status IN ('pending','running')) THEN 'ready' ELSE status END
       WHERE id = ?`,
    )
    .bind(now, runId)
}

export async function noticeRecipients(db: D1Database, runId: string): Promise<{ evaluationId: string; recipients: string[] } | null> {
  const run = await db.prepare('SELECT evaluation_id, owner_user_id FROM runs WHERE id = ?').bind(runId).first<{ evaluation_id: string; owner_user_id: string }>()
  if (!run) return null
  const reviewers = await db
    .prepare(`SELECT reviewer_user_id FROM review_sessions WHERE run_id = ? AND status <> 'revoked'`)
    .bind(runId)
    .all<{ reviewer_user_id: string }>()
  // Guest jurors (D-41) have no socket identity; they poll instead, so no notice rows are written for them.
  const signedIn = reviewers.results.map((row) => row.reviewer_user_id).filter((id) => !id.startsWith('mcj_'))
  return { evaluationId: run.evaluation_id, recipients: [...new Set([run.owner_user_id, ...signedIn])] }
}

/** Publish safe invalidations for a run; never throws. */
export async function notifyRun(deps: Deps, runId: string): Promise<void> {
  try {
    const target = await noticeRecipients(deps.db, runId)
    if (!target) return
    await deps.publishNotices(target.recipients.map((recipientUserId) => ({ recipientUserId, evaluationId: target.evaluationId, runId })))
  } catch {
    deps.log({ event: 'notice.publish_failed', runId })
  }
}

// ---------------------------------------------------------------------------
// Dispatch (outbox → JobRoom)
// ---------------------------------------------------------------------------

const BACKOFF_MS = [5_000, 30_000, 60_000]
const UNCLAIMED_REDISPATCH_MS = 5 * 60_000

export async function dispatchOutbox(deps: Deps, runId?: string): Promise<number> {
  const now = deps.now()
  const rows = await deps.db
    .prepare(
      `SELECT o.id, o.generation_id, o.attempt_no, o.dispatch_count FROM outbox o JOIN generations g ON g.id = o.generation_id
       WHERE (? IS NULL OR g.run_id = ?)
         AND ((o.status = 'pending' AND o.next_dispatch_at <= ?) OR (o.status = 'dispatched' AND o.updated_at <= ?))
       ORDER BY o.created_at LIMIT 50`,
    )
    .bind(runId ?? null, runId ?? null, now, now - UNCLAIMED_REDISPATCH_MS)
    .all<{ id: string; generation_id: string; attempt_no: number; dispatch_count: number }>()
  let dispatched = 0
  for (const row of rows.results) {
    try {
      const jobId = await deps.enqueueGeneration({ outboxId: row.id, generationId: row.generation_id, attemptNo: row.attempt_no })
      await deps.db
        .prepare(`UPDATE outbox SET status = 'dispatched', job_id = ?, dispatch_count = dispatch_count + 1, updated_at = ? WHERE id = ? AND status IN ('pending','dispatched')`)
        .bind(jobId, now, row.id)
        .run()
      dispatched++
    } catch {
      const delay = BACKOFF_MS[Math.min(row.dispatch_count, BACKOFF_MS.length - 1)]
      await deps.db
        .prepare(`UPDATE outbox SET dispatch_count = dispatch_count + 1, next_dispatch_at = ?, last_error_code = 'ENQUEUE_FAILED', updated_at = ? WHERE id = ? AND status = 'pending'`)
        .bind(now + delay, now, row.id)
        .run()
      deps.log({ event: 'outbox.enqueue_failed', outboxId: row.id })
    }
  }
  return dispatched
}

// ---------------------------------------------------------------------------
// Job handler
// ---------------------------------------------------------------------------

interface ClaimContext {
  runId: string
  provider: ProviderId
  caseKey: string
  configurationKey: string
  snapshot: RunSnapshot
  queuedAt: number
}

async function loadClaimContext(db: D1Database, job: GenerationJob): Promise<ClaimContext | null> {
  const row = await db
    .prepare(
      `SELECT g.run_id, g.provider, g.case_key, g.configuration_key, r.snapshot_json, o.created_at AS queued_at
       FROM generations g JOIN runs r ON r.id = g.run_id JOIN outbox o ON o.generation_id = g.id AND o.attempt_no = ?
       WHERE g.id = ? AND o.id = ?`,
    )
    .bind(job.attemptNo, job.generationId, job.outboxId)
    .first<{ run_id: string; provider: ProviderId; case_key: string; configuration_key: string; snapshot_json: string; queued_at: number }>()
  if (!row) return null
  return {
    runId: row.run_id,
    provider: row.provider,
    caseKey: row.case_key,
    configurationKey: row.configuration_key,
    snapshot: JSON.parse(row.snapshot_json) as RunSnapshot,
    queuedAt: row.queued_at,
  }
}

export type JobOutcome = 'not_claimed' | 'succeeded' | 'failed' | 'uncertain' | 'stale'

export async function handleGenerationJob(deps: Deps, job: GenerationJob, jobSignal: AbortSignal, requestId: string): Promise<JobOutcome> {
  const db = deps.db
  const context = await loadClaimContext(db, job)
  if (!context) return 'not_claimed'

  const claimedAt = deps.now()
  const attemptId = deps.newId()
  const fence = deps.newId()
  try {
    await runGuarded(
      db,
      'generation.claim',
      all(
        cond(`EXISTS (SELECT 1 FROM generations WHERE id = ? AND status = 'pending' AND attempt_count = ?)`, job.generationId, job.attemptNo),
        cond(`EXISTS (SELECT 1 FROM runs r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = ? AND r.status = 'generating' AND e.deleted_at IS NULL)`, context.runId),
        cond(`EXISTS (SELECT 1 FROM attempt_reservations WHERE generation_id = ? AND attempt_no = ? AND state = 'reserved')`, job.generationId, job.attemptNo),
        cond(
          `EXISTS (SELECT 1 FROM run_credentials rc JOIN provider_credentials c ON c.id = rc.credential_id WHERE rc.run_id = ? AND rc.provider = ? AND c.status = 'active')`,
          context.runId,
          context.provider,
        ),
      ),
      [
        db.prepare(`UPDATE generations SET status = 'running', updated_at = ? WHERE id = ?`).bind(claimedAt, job.generationId),
        db
          .prepare(
            `INSERT INTO generation_attempts (id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, queue_wait_ms)
             VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
          )
          .bind(attemptId, job.generationId, job.attemptNo, fence, claimedAt, claimedAt + LIMITS.attemptLeaseMs, Math.max(0, claimedAt - context.queuedAt)),
        db.prepare(`UPDATE attempt_reservations SET state = 'consumed' WHERE generation_id = ? AND attempt_no = ? AND state = 'reserved'`).bind(job.generationId, job.attemptNo),
        db.prepare(`UPDATE outbox SET status = 'claimed', updated_at = ? WHERE id = ?`).bind(claimedAt, job.outboxId),
        touchRunStatement(db, context.runId, claimedAt),
        auditStatement(db, { eventType: 'attempt.claim', requestId, outcome: 'ok', runId: context.runId, metadata: { generationId: job.generationId, attemptNo: job.attemptNo } }, claimedAt),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) {
      deps.log({ event: 'attempt.claim_skipped', generationId: job.generationId, attemptNo: job.attemptNo })
      return 'not_claimed' // duplicate, stale, canceled, revoked, or deleted
    }
    throw error
  }
  await notifyRun(deps, context.runId)

  const testCase = context.snapshot.cases.find((item) => item.key === context.caseKey)
  const found = context.snapshot.configurations.find((item) => item.key === context.configurationKey)
  // Imported parties never have generations; refuse rather than call a provider for one.
  const configuration = found && !isImportedSnapshot(found) ? found : undefined
  if (!testCase || !configuration) {
    return finishAttempt(deps, { attemptId, fence, job, context, requestId }, { kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, providerRequestId: null, durationMs: 0 }, true)
  }
  const conversation = buildConversation(context.snapshot.messageTemplateVersion ?? MESSAGE_TEMPLATE_VERSION, configuration.systemPrompt, testCase)
  // Dispatch by the adapter version this hearing recorded (D-39); refuse, unsent, if it cannot carry the messages.
  const adapter = adapterFor(configuration.adapterVersion, conversation.messages.length)
  if (!adapter) {
    return finishAttempt(deps, { attemptId, fence, job, context, requestId }, { kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, providerRequestId: null, durationMs: 0 }, true)
  }
  const timeout = AbortSignal.timeout(deps.config.providerTimeoutMs)
  const signal = AbortSignal.any([jobSignal, timeout])

  let outcome: ProviderOutcome
  let unsent = false
  try {
    outcome = await withRunCredential(deps, context.runId, context.provider, requestId, async (apiKey) => {
      // Canceled or deleted since claim: send nothing (the attempt is already fenced out).
      if (!(await attemptStillCurrent(deps.db, attemptId, fence, context.runId))) throw new AttemptFenced()
      return adapter(deps.providerFetch, { modelId: configuration.modelId, system: conversation.system, messages: conversation.messages, maxOutputTokens: configuration.maxOutputTokens, apiKey, signal }, timeout)
    })
  } catch (error) {
    if (error instanceof AttemptFenced) {
      deps.log({ event: 'attempt.fenced_before_send', generationId: job.generationId, attemptNo: job.attemptNo })
      // Provably unsent: release the unit and close the attempt instead of leaving it to expire as uncertain.
      try {
        const now = deps.now()
        await runGuarded(deps.db, 'attempt.fenced', cond(`EXISTS (SELECT 1 FROM generation_attempts WHERE id = ? AND fence_token = ? AND status = 'running')`, attemptId, fence), [
          ...releaseReservations(deps.db, cond('r.generation_id = ? AND r.attempt_no = ?', job.generationId, job.attemptNo), 'consumed', now),
          deps.db.prepare(`UPDATE generation_attempts SET status = 'failed', error_code = 'CANCELED', finished_at = ? WHERE id = ?`).bind(now, attemptId),
        ])
      } catch (fenceError) {
        if (!(fenceError instanceof GuardFailed)) throw fenceError
      }
      return 'stale'
    }
    if (error instanceof CredentialUnusable) {
      // Failed before any network send: no fallback key, no platform credit.
      unsent = true
      outcome = { kind: 'failure', code: error.code, definite: true, providerRequestId: null, durationMs: 0 }
    } else {
      outcome = { kind: 'failure', code: 'PROVIDER_NETWORK_ERROR', definite: false, providerRequestId: null, durationMs: 0 }
    }
  }
  return finishAttempt(deps, { attemptId, fence, job, context, requestId }, outcome, unsent)
}

interface AttemptRef {
  attemptId: string
  fence: string
  job: GenerationJob
  context: ClaimContext
  requestId: string
}

async function finishAttempt(deps: Deps, ref: AttemptRef, outcome: ProviderOutcome, unsent: boolean): Promise<JobOutcome> {
  const db = deps.db
  const now = deps.now()
  const { job, context } = ref
  const current = all(
    cond(`EXISTS (SELECT 1 FROM generation_attempts WHERE id = ? AND fence_token = ? AND status = 'running')`, ref.attemptId, ref.fence),
    cond(`EXISTS (SELECT 1 FROM runs r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = ? AND r.status = 'generating' AND e.deleted_at IS NULL)`, context.runId),
  )
  const terminalOutbox = db.prepare(`UPDATE outbox SET status = 'terminal', updated_at = ? WHERE id = ?`).bind(now, job.outboxId)

  try {
    if (outcome.kind === 'success') {
      await runGuarded(
        db,
        'generation.complete',
        all(
          current,
          // A response finishing after key removal cannot bypass the revocation fence.
          cond(
            `EXISTS (SELECT 1 FROM run_credentials rc JOIN provider_credentials c ON c.id = rc.credential_id WHERE rc.run_id = ? AND rc.provider = ? AND c.status = 'active')`,
            context.runId,
            context.provider,
          ),
        ),
        [
          db
            .prepare(
              `UPDATE generation_attempts SET status = 'succeeded', finished_at = ?, output_text = ?, finish_reason = ?, input_tokens = ?, output_tokens = ?,
                 duration_ms = ?, provider_request_id = ?, observed_model = ?, truncated = ? WHERE id = ?`,
            )
            .bind(now, outcome.text, outcome.finishReason, outcome.inputTokens, outcome.outputTokens, outcome.durationMs, outcome.providerRequestId, outcome.observedModel, outcome.truncated ? 1 : 0, ref.attemptId),
          db.prepare(`UPDATE generations SET status = 'succeeded', accepted_attempt_id = ?, last_error_code = NULL, updated_at = ? WHERE id = ?`).bind(ref.attemptId, now, job.generationId),
          terminalOutbox,
          touchRunStatement(db, context.runId, now),
          auditStatement(db, { eventType: 'attempt.complete', requestId: ref.requestId, outcome: 'succeeded', runId: context.runId, metadata: { generationId: job.generationId, attemptNo: job.attemptNo, truncated: outcome.truncated } }, now),
        ],
      )
    } else {
      const status = outcome.definite ? 'failed' : 'uncertain'
      await runGuarded(db, 'generation.fail', current, [
        ...(unsent ? releaseReservations(db, cond('r.generation_id = ? AND r.attempt_no = ?', job.generationId, job.attemptNo), 'consumed', now) : []),
        db
          .prepare(`UPDATE generation_attempts SET status = ?, finished_at = ?, error_code = ?, duration_ms = ?, provider_request_id = ? WHERE id = ?`)
          .bind(status, now, outcome.code, outcome.durationMs, outcome.providerRequestId, ref.attemptId),
        db.prepare(`UPDATE generations SET status = ?, last_error_code = ?, updated_at = ? WHERE id = ?`).bind(status, outcome.code, now, job.generationId),
        terminalOutbox,
        touchRunStatement(db, context.runId, now),
        auditStatement(db, { eventType: 'attempt.complete', requestId: ref.requestId, outcome: status, runId: context.runId, metadata: { generationId: job.generationId, attemptNo: job.attemptNo, code: outcome.code } }, now),
      ])
    }
  } catch (error) {
    if (error instanceof GuardFailed) {
      // Canceled, deleted, lease-expired, or revoked meanwhile: evidence is unchanged.
      deps.log({ event: 'attempt.stale_commit_rejected', generationId: job.generationId, attemptNo: job.attemptNo })
      return 'stale'
    }
    throw error
  }
  await notifyRun(deps, context.runId)
  return outcome.kind === 'success' ? 'succeeded' : outcome.definite ? 'failed' : 'uncertain'
}

// ---------------------------------------------------------------------------
// Lease reconciliation (cron + on run read). Never contacts a provider.
// ---------------------------------------------------------------------------

export async function reconcileLeases(deps: Deps, runId?: string): Promise<number> {
  const db = deps.db
  const now = deps.now()
  const expired = await db
    .prepare(
      `SELECT a.id, a.fence_token, a.generation_id, a.attempt_no, g.run_id FROM generation_attempts a JOIN generations g ON g.id = a.generation_id
       WHERE a.status = 'running' AND a.deadline_at <= ? AND (? IS NULL OR g.run_id = ?) LIMIT 50`,
    )
    .bind(now, runId ?? null, runId ?? null)
    .all<{ id: string; fence_token: string; generation_id: string; attempt_no: number; run_id: string }>()
  let count = 0
  for (const attempt of expired.results) {
    try {
      await runGuarded(
        db,
        'attempt.lease_expired',
        cond(`EXISTS (SELECT 1 FROM generation_attempts WHERE id = ? AND fence_token = ? AND status = 'running' AND deadline_at <= ?)`, attempt.id, attempt.fence_token, now),
        [
          // Send cannot be proven absent: the reservation stays consumed.
          db.prepare(`UPDATE generation_attempts SET status = 'uncertain', error_code = 'PROVIDER_LEASE_EXPIRED', finished_at = ? WHERE id = ?`).bind(now, attempt.id),
          db.prepare(`UPDATE generations SET status = 'uncertain', last_error_code = 'PROVIDER_LEASE_EXPIRED', updated_at = ? WHERE id = ? AND status = 'running'`).bind(now, attempt.generation_id),
          db.prepare(`UPDATE outbox SET status = 'terminal', updated_at = ? WHERE generation_id = ? AND attempt_no = ?`).bind(now, attempt.generation_id, attempt.attempt_no),
          touchRunStatement(db, attempt.run_id, now),
        ],
      )
      count++
      await notifyRun(deps, attempt.run_id)
    } catch (error) {
      if (!(error instanceof GuardFailed)) throw error
    }
  }
  return count
}
