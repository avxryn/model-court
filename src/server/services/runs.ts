/**
 * Run admission and owner run management (F05–F08, F18, F27).
 */

import { z } from 'zod'
import { canonicalJson, sha256Hex } from '../../domain/canonical'
import { cancelRunSchema, retrySchema, startRunSchema } from '../../domain/contracts'
import { LIMITS } from '../../domain/limits'
import { PROVIDER_NAMES, type ProviderId } from '../../domain/registry'
import { buildSnapshot, describeIssue, generatedParties, importCoverageIssues, isImportedSnapshot, readinessIssues, requiredProviders, samplesPerAnswer, type ImportMeta, type RunSnapshot } from '../../domain/snapshot'
import { canRun, isRetryable, type GenerationStatus, type RunStatus } from '../../domain/transitions'
import { loadEvaluationAccess, loadRunAccess, requireOwner, type RunAccess } from '../access'
import { all, auditStatement, budgetSubjects, classifyConstraint, cond, GuardFailed, releaseReservations, reserveBudget, runGuarded, type Condition } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, revisionConflict, stateConflict } from '../http'
import { idempotent, requestHash } from '../receipts'
import { importedCheckStatements } from './checks'
import { configurationCapError, parseStoredDraft, samplesCapError } from './evaluations'
import { dispatchOutbox, notifyRun, reconcileLeases } from './generation'
import { guestNames } from './guest-jurors'

export interface GenerationRow {
  id: string
  run_id: string
  case_key: string
  configuration_key: string
  provider: ProviderId
  status: GenerationStatus
  attempt_count: number
  accepted_attempt_id: string | null
  last_error_code: string | null
  /** D-65: 1 unless the hearing asked for repeats. */
  sample_no: number
}

/** Every sample of one (question, party) slot, lowest sample first (D-65). */
export function samplesFor<G extends Pick<GenerationRow, 'case_key' | 'configuration_key' | 'sample_no'>>(generations: readonly G[], caseKey: string, configurationKey: string): G[] {
  return generations.filter((g) => g.case_key === caseKey && g.configuration_key === configurationKey).sort((a, b) => a.sample_no - b.sample_no)
}

/**
 * The sample the jury scores: the lowest-numbered succeeded one. Deterministic and never chosen by
 * content. Null when no sample succeeded.
 */
export function primarySample<G extends Pick<GenerationRow, 'case_key' | 'configuration_key' | 'sample_no' | 'status' | 'accepted_attempt_id'>>(generations: readonly G[], caseKey: string, configurationKey: string): G | null {
  return samplesFor(generations, caseKey, configurationKey).find((g) => g.status === 'succeeded' && g.accepted_attempt_id !== null) ?? null
}

export interface EligibleManifest {
  caseKeys: string[]
  excludedCaseKeys: string[]
  /** Generated entries carry a generation and attempt; imported entries (D-38) carry `importedOutputId` and null ids. */
  entries: Array<{ caseKey: string; configurationKey: string; generationId: string | null; acceptedAttemptId: string | null; importedOutputId?: string; /** D-65: the primary sample when it is not 1. */ sampleNo?: number }>
}

export function parseSnapshot(json: string): RunSnapshot {
  return JSON.parse(json) as RunSnapshot
}

function credentialActive(runId: string, provider: ProviderId, now: number): Condition {
  return cond(
    `EXISTS (SELECT 1 FROM run_credentials rc JOIN provider_credentials c ON c.id = rc.credential_id WHERE rc.run_id = ? AND rc.provider = ? AND c.status = 'active' AND (c.expires_at IS NULL OR c.expires_at > ?))`,
    runId,
    provider,
    now,
  )
}

// ---------------------------------------------------------------------------
// Key pins (D-57): a hearing whose pinned key was removed or expired can be
// re-pinned, on retry, to the judge's current key for the same provider.
// ---------------------------------------------------------------------------

export interface PinnedKey {
  provider: ProviderId
  credentialId: string
  /** Active and unexpired: generation can use it. */
  usable: boolean
}

export async function loadPinnedKeys(db: D1Database, runId: string, now: number): Promise<PinnedKey[]> {
  const rows = (
    await db
      .prepare(
        `SELECT rc.provider, rc.credential_id, CASE WHEN c.status = 'active' AND (c.expires_at IS NULL OR c.expires_at > ?) THEN 1 ELSE 0 END AS usable
         FROM run_credentials rc JOIN provider_credentials c ON c.id = rc.credential_id WHERE rc.run_id = ? ORDER BY rc.provider`,
      )
      .bind(now, runId)
      .all<{ provider: ProviderId; credential_id: string; usable: number }>()
  ).results
  return rows.map((row) => ({ provider: row.provider, credentialId: row.credential_id, usable: row.usable === 1 }))
}

interface Repin {
  provider: ProviderId
  from: string
  to: string
}

function repinRequired(provider: ProviderId): ApiError {
  const name = PROVIDER_NAMES[provider]
  return new ApiError(409, 'CREDENTIAL_MISSING', `The ${name} key pinned to this hearing was removed or expired. Retry with your current ${name} key, or add one in Settings first.`, {
    details: { provider, repinRequired: true },
  })
}

/** Which providers move to the offered key. A usable pin is kept even when another key is offered. */
export function planRepins(pins: readonly PinnedKey[], providers: readonly ProviderId[], offered: Partial<Record<ProviderId, string>>): Repin[] {
  return providers.flatMap((provider) => {
    const pin = pins.find((candidate) => candidate.provider === provider)
    if (!pin) throw new ApiError(409, 'CREDENTIAL_MISSING', 'This hearing has no key recorded for that provider.')
    if (pin.usable) return []
    const to = offered[provider]
    if (!to) throw repinRequired(provider)
    return to === pin.credentialId ? [] : [{ provider, from: pin.credentialId, to }]
  })
}

/** Commit-time check: the old pin is still in place and unusable, and the new key is the owner's, active and unexpired. */
function repinAllowed(runId: string, ownerUserId: string, repin: Repin, now: number): Condition {
  return all(
    cond(
      `EXISTS (SELECT 1 FROM run_credentials rc JOIN provider_credentials c ON c.id = rc.credential_id
        WHERE rc.run_id = ? AND rc.provider = ? AND rc.credential_id = ? AND (c.status <> 'active' OR (c.expires_at IS NOT NULL AND c.expires_at <= ?)))`,
      runId,
      repin.provider,
      repin.from,
      now,
    ),
    cond(`EXISTS (SELECT 1 FROM provider_credentials WHERE id = ? AND owner_user_id = ? AND provider = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?))`, repin.to, ownerUserId, repin.provider, now),
  )
}

function repinStatements(db: D1Database, args: Repin & { runId: string; evaluationId: string; userId: string; requestId: string; now: number }): D1PreparedStatement[] {
  return [
    db.prepare('UPDATE run_credentials SET credential_id = ? WHERE run_id = ? AND provider = ? AND credential_id = ?').bind(args.to, args.runId, args.provider, args.from),
    // Key ids only, never key material.
    auditStatement(
      db,
      { eventType: 'run.credential_repin', requestId: args.requestId, outcome: 'ok', actorUserId: args.userId, runId: args.runId, evaluationId: args.evaluationId, metadata: { provider: args.provider, fromCredentialId: args.from, toCredentialId: args.to } },
      args.now,
    ),
  ]
}

function capacity(ownerUserId: string, excludeRunId: string | null): Condition {
  return all(
    cond(`(SELECT COUNT(*) FROM runs WHERE owner_user_id = ? AND status = 'generating' AND id IS NOT ?) < 1`, ownerUserId, excludeRunId),
    cond(`(SELECT COUNT(*) FROM runs WHERE status = 'generating' AND id IS NOT ?) < 2`, excludeRunId),
  )
}

function requireGenerationEnabled(deps: Deps): void {
  if (!deps.config.generationEnabled) {
    throw new ApiError(503, 'GENERATION_DISABLED', 'Live generation is disabled on this deployment. The sample remains available.')
  }
}

function quotaError(): ApiError {
  return new ApiError(429, 'QUOTA_EXHAUSTED', 'The provider-call limit for today (or for this deployment) has been reached. Existing work is preserved.', {
    retryAfterSeconds: Math.ceil((86_400_000 - (Date.now() % 86_400_000)) / 1000),
  })
}

// ---------------------------------------------------------------------------
// Start a run
// ---------------------------------------------------------------------------

export async function startRun(deps: Deps, userId: string, evaluationId: string, input: z.output<typeof startRunSchema>, key: string, requestId: string) {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  // Owner first: a juror must not learn anything about the draft from which error comes back.
  requireOwner(access)
  // A hearing with only imported parties makes no provider calls, so the generation switch does not apply to it.
  if (generatedParties(parseStoredDraft(access.evaluation).configurations).length > 0) requireGenerationEnabled(deps)
  const db = deps.db
  const operation = `run.start:${evaluationId}`
  const hash = await requestHash(operation, input)

  const result = await idempotent(deps, { actorUserId: userId, idempotencyKey: key, operation, requestHash: hash }, async (receipt) => {
    if (access.evaluation.revision !== input.draftRevision) throw revisionConflict()
    const draft = parseStoredDraft(access.evaluation)
    const capError = configurationCapError(deps, draft.configurations.length) ?? samplesCapError(deps, draft.samplesPerAnswer)
    if (capError) throw capError
    const issues = readinessIssues(draft, deps.routes)
    if (issues.length > 0) {
      throw new ApiError(422, 'UNSUPPORTED_CONFIGURATION', describeIssue(issues[0]), { details: { issues } })
    }
    const providers = requiredProviders(draft.configurations, deps.routes)
    const supplied = Object.keys(input.credentialIdsByProvider).sort()
    if (canonicalJson(supplied) !== canonicalJson(providers)) {
      throw new ApiError(422, 'CREDENTIAL_MISSING', 'Provide exactly one saved key for each selected provider.', { details: { requiredProviders: providers } })
    }

    const importRows = (
      await db
        .prepare('SELECT configuration_key, case_key, text, text_sha256, byte_length FROM evaluation_imports WHERE evaluation_id = ?')
        .bind(evaluationId)
        .all<{ configuration_key: string; case_key: string; text: string; text_sha256: string; byte_length: number }>()
    ).results
    const importMetas: ImportMeta[] = importRows.map((row) => ({ configurationKey: row.configuration_key, caseKey: row.case_key, sha256: row.text_sha256, byteLength: row.byte_length }))
    const missing = importCoverageIssues(draft, importMetas)
    if (missing.length > 0) {
      throw new ApiError(422, 'UNSUPPORTED_CONFIGURATION', describeIssue(missing[0]), { details: { issues: missing } })
    }

    const now = deps.now()
    const runId = deps.newId()
    const snapshot = buildSnapshot(draft, deps.routes, deps.config.appCommit, now, importMetas)
    const snapshotJson = JSON.stringify(snapshot)
    if (new TextEncoder().encode(snapshotJson).byteLength > LIMITS.snapshotJsonBytes) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'The run snapshot exceeds 96 KiB.')
    }
    const snapshotHash = await sha256Hex(canonicalJson(snapshot))
    const subjects = budgetSubjects(userId, now)

    // D-65: one generation per (question, party, sample). Sample k is first dispatched (k − 1) minutes
    // later, so the minute cron spreads a repeated hearing's burst instead of sending it all at once.
    const samples = samplesPerAnswer(snapshot)
    const generations = snapshot.cases.flatMap((testCase) =>
      generatedParties(snapshot.configurations).flatMap((configuration) =>
        Array.from({ length: samples }, (_, index) => ({ id: deps.newId(), outboxId: deps.newId(), caseKey: testCase.key, configurationKey: configuration.key, provider: configuration.provider, sampleNo: index + 1, dispatchAt: now + index * LIMITS.sampleStaggerMs })),
      ),
    )
    const imported = snapshot.configurations.filter(isImportedSnapshot).flatMap((configuration) => configuration.imports.map((item) => ({ id: deps.newId(), configurationKey: configuration.key, ...item })))
    // With nothing to generate, the hearing is ready for review at once and touches no budget.
    const initialStatus: RunStatus = generations.length > 0 ? 'generating' : 'ready'
    const response = { status: 202 as const, data: { runId, status: initialStatus, revision: 1, plannedCalls: generations.length } }

    const credentialChecks = providers.map((provider) =>
      cond(
        `EXISTS (SELECT 1 FROM provider_credentials WHERE id = ? AND owner_user_id = ? AND provider = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?))`,
        input.credentialIdsByProvider[provider],
        userId,
        provider,
        now,
      ),
    )

    const statements: D1PreparedStatement[] = [
      receipt(response, runId),
      db
        .prepare(
          `INSERT INTO runs (id, evaluation_id, owner_user_id, status, snapshot_json, snapshot_hash, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(runId, evaluationId, userId, initialStatus, snapshotJson, snapshotHash, now, now),
      ...providers.map((provider) =>
        db.prepare('INSERT INTO run_credentials (run_id, provider, credential_id) VALUES (?, ?, ?)').bind(runId, provider, input.credentialIdsByProvider[provider]),
      ),
      ...(generations.length > 0 ? reserveBudget(db, subjects, generations.length, deps.config.limits, now) : []),
      // Freeze each imported answer exactly as hashed into the snapshot (D-38).
      ...imported.map((item) =>
        db
          .prepare(
            `INSERT INTO run_imported_outputs (id, run_id, configuration_key, case_key, text, text_sha256, byte_length, created_at)
             SELECT ?, ?, configuration_key, case_key, text, text_sha256, byte_length, ? FROM evaluation_imports
             WHERE evaluation_id = ? AND configuration_key = ? AND case_key = ? AND text_sha256 = ?`,
          )
          .bind(item.id, runId, now, evaluationId, item.configurationKey, item.caseKey, item.sha256),
      ),
      // Spec 03 (D-76): automatic checks on each frozen imported answer, the same text the snapshot hashes.
      ...importedCheckStatements(deps, snapshot, runId, imported.map((item) => ({ ...item, text: importRows.find((row) => row.configuration_key === item.configurationKey && row.case_key === item.caseKey)?.text ?? '' })), now),
      ...generations.flatMap((generation) => [
        db
          .prepare(
            `INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, attempt_count, created_at, updated_at, sample_no)
             VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)`,
          )
          .bind(generation.id, runId, generation.caseKey, generation.configurationKey, generation.provider, now, now, generation.sampleNo),
        db
          .prepare(
            `INSERT INTO attempt_reservations (generation_id, attempt_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at)
             VALUES (?, 1, ?, ?, ?, ?, 'reserved', ?)`,
          )
          .bind(generation.id, subjects.actor, subjects.global, subjects.lifetime, subjects.windowStart, now),
        db
          .prepare(`INSERT INTO outbox (id, generation_id, attempt_no, status, next_dispatch_at, created_at, updated_at) VALUES (?, ?, 1, 'pending', ?, ?, ?)`)
          .bind(generation.outboxId, generation.id, generation.dispatchAt, now, now),
      ]),
      db.prepare('UPDATE evaluations SET updated_at = ? WHERE id = ?').bind(now, evaluationId),
      auditStatement(db, { eventType: 'run.create', requestId, outcome: 'ok', actorUserId: userId, evaluationId, runId, metadata: { plannedCalls: generations.length, providers: providers.join(','), ...(samples > 1 ? { samplesPerAnswer: samples } : {}) } }, now),
    ]

    try {
      await runGuarded(
        db,
        'run.start',
        all(
          cond('EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL)', evaluationId, userId, input.draftRevision),
          ...credentialChecks,
          ...(generations.length > 0 ? [capacity(userId, null)] : []),
          ...imported.map((item) =>
            cond('EXISTS (SELECT 1 FROM evaluation_imports WHERE evaluation_id = ? AND configuration_key = ? AND case_key = ? AND text_sha256 = ?)', evaluationId, item.configurationKey, item.caseKey, item.sha256),
          ),
        ),
        statements,
      )
    } catch (error) {
      if (error instanceof GuardFailed) throw await explainAdmissionFailure(deps, userId, evaluationId, input)
      const kind = classifyConstraint(error)
      if (kind === 'active_run') throw new ApiError(409, 'ACTIVE_RUN_EXISTS', 'This evaluation already has an unfinished run. Finish or cancel it first.')
      if (kind === 'budget') throw quotaError()
      throw error
    }
    return response
  })

  if (!result.replayed) {
    const runId = (result.data as { runId: string }).runId
    await dispatchOutbox(deps, runId) // best effort; cron repairs anything left pending
    await notifyRun(deps, runId)
  }
  return result
}

async function explainAdmissionFailure(deps: Deps, userId: string, evaluationId: string, input: z.output<typeof startRunSchema>): Promise<ApiError> {
  const evaluation = await deps.db.prepare('SELECT revision FROM evaluations WHERE id = ? AND deleted_at IS NULL').bind(evaluationId).first<{ revision: number }>()
  if (!evaluation || evaluation.revision !== input.draftRevision) return revisionConflict()
  const active = await deps.db.prepare(`SELECT 1 AS ok FROM runs WHERE evaluation_id = ? AND status IN ('generating','ready','reviewing')`).bind(evaluationId).first()
  if (active) return new ApiError(409, 'ACTIVE_RUN_EXISTS', 'This evaluation already has an unfinished run. Finish or cancel it first.')
  for (const [provider, id] of Object.entries(input.credentialIdsByProvider)) {
    const row = await deps.db
      .prepare(`SELECT 1 AS ok FROM provider_credentials WHERE id = ? AND owner_user_id = ? AND provider = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`)
      .bind(id, userId, provider, deps.now())
      .first()
    if (!row) return new ApiError(422, 'CREDENTIAL_MISSING', `The selected ${provider} key is missing, expired, revoked, or not yours. Add or renew a key in Settings.`)
  }
  return new ApiError(429, 'RATE_LIMITED', 'Another comparison is already generating. Wait for it to finish, then try again.', { retryable: true })
}

// ---------------------------------------------------------------------------
// Read a run (role-specific projection)
// ---------------------------------------------------------------------------

export async function loadGenerations(db: D1Database, runId: string): Promise<GenerationRow[]> {
  return (await db.prepare('SELECT * FROM generations WHERE run_id = ? ORDER BY created_at, id').bind(runId).all<GenerationRow>()).results
}

export interface ImportedOutputRow {
  id: string
  configuration_key: string
  case_key: string
}

export async function loadImportedOutputs(db: D1Database, runId: string): Promise<ImportedOutputRow[]> {
  return (await db.prepare('SELECT id, configuration_key, case_key FROM run_imported_outputs WHERE run_id = ? ORDER BY id').bind(runId).all<ImportedOutputRow>()).results
}

/**
 * A question is eligible when every generated party has at least one succeeded
 * sample and every imported party has its frozen answer. The entry for a generated
 * party is its primary sample (lowest-numbered success, D-65); the others never reach
 * a juror. Entries are in snapshot party order.
 */
export function computeEligibility(snapshot: RunSnapshot, generations: readonly GenerationRow[], importedOutputs: readonly ImportedOutputRow[] = []): EligibleManifest {
  const caseKeys: string[] = []
  const excludedCaseKeys: string[] = []
  const entries: EligibleManifest['entries'] = []
  for (const testCase of snapshot.cases) {
    const forCase = snapshot.configurations.map((configuration): EligibleManifest['entries'][number] | null => {
      if (isImportedSnapshot(configuration)) {
        const row = importedOutputs.find((output) => output.case_key === testCase.key && output.configuration_key === configuration.key)
        return row ? { caseKey: testCase.key, configurationKey: configuration.key, generationId: null, acceptedAttemptId: null, importedOutputId: row.id } : null
      }
      const primary = primarySample(generations, testCase.key, configuration.key)
      return primary
        ? { caseKey: testCase.key, configurationKey: configuration.key, generationId: primary.id, acceptedAttemptId: primary.accepted_attempt_id, ...(primary.sample_no > 1 ? { sampleNo: primary.sample_no } : {}) }
        : null
    })
    if (forCase.every((entry) => entry !== null)) {
      caseKeys.push(testCase.key)
      entries.push(...(forCase as Array<EligibleManifest['entries'][number]>))
    } else {
      excludedCaseKeys.push(testCase.key)
    }
  }
  return { caseKeys, excludedCaseKeys, entries }
}

export async function getRun(deps: Deps, userId: string, runId: string) {
  let access = await loadRunAccess(deps.db, runId, userId)
  if (access.role === 'owner' && (access.run.status === 'generating' || access.run.status === 'ready')) {
    // Cheap per-run lease reconciliation so abandoned work does not wait for cron (§10.2).
    if ((await reconcileLeases(deps, runId)) > 0) access = await loadRunAccess(deps.db, runId, userId)
    // A complete hearing whose automatic opening has not happened yet (imported-only, or a missed job hook).
    if (access.run.status === 'ready' && (await autoOpenReview(deps, runId, `auto_${runId}`))) {
      await notifyRun(deps, runId)
      access = await loadRunAccess(deps.db, runId, userId)
    }
  }
  return access.role === 'owner' ? ownerRunView(deps, access) : reviewerRunView(access)
}

function reviewerRunView(access: RunAccess) {
  // Deliberately minimal: no configuration, provider, generation, or peer data.
  return {
    runId: access.run.id,
    role: 'reviewer' as const,
    evaluationId: access.evaluation.id,
    evaluationTitle: access.evaluation.title,
    status: access.run.status,
    revision: access.run.revision,
    session: access.session ? { id: access.session.id, status: access.session.status, submittedAt: access.session.submitted_at } : null,
  }
}

async function ownerRunView(deps: Deps, access: RunAccess) {
  const db = deps.db
  const { run } = access
  const snapshot = parseSnapshot(run.snapshot_json)
  const generations = await loadGenerations(db, run.id)
  const attempts = (
    await db
      .prepare(
        `SELECT a.generation_id, a.attempt_no, a.status, a.error_code, a.duration_ms, a.queue_wait_ms, a.truncated
         FROM generation_attempts a JOIN generations g ON g.id = a.generation_id WHERE g.run_id = ? ORDER BY a.attempt_no`,
      )
      .bind(run.id)
      .all<{ generation_id: string; attempt_no: number; status: string; error_code: string | null; duration_ms: number | null; queue_wait_ms: number | null; truncated: number }>()
  ).results
  const sessions = (
    await db
      .prepare(`SELECT id, reviewer_user_id, context_type, status, submitted_at, joined_at FROM review_sessions WHERE run_id = ? ORDER BY joined_at`)
      .bind(run.id)
      .all<{ id: string; reviewer_user_id: string; context_type: 'invited' | 'owner'; status: string; submitted_at: number | null; joined_at: number }>()
  ).results
  const guests = await guestNames(db, run.id)
  const invites = (
    await db.prepare(`SELECT id, expires_at, redeemed_at, revoked_at FROM invites WHERE run_id = ? ORDER BY created_at`).bind(run.id).all<{ id: string; expires_at: number; redeemed_at: number | null; revoked_at: number | null }>()
  ).results
  const now = deps.now()
  const importedOutputs = await loadImportedOutputs(db, run.id)
  const manifest: EligibleManifest = run.eligible_manifest_json ? (JSON.parse(run.eligible_manifest_json) as EligibleManifest) : computeEligibility(snapshot, generations, importedOutputs)
  const counts: Record<GenerationStatus, number> = { pending: 0, running: 0, succeeded: 0, failed: 0, uncertain: 0, canceled: 0 }
  for (const generation of generations) counts[generation.status]++

  let invitedIndex = 0
  return {
    runId: run.id,
    role: 'owner' as const,
    evaluationId: access.evaluation.id,
    evaluationTitle: access.evaluation.title,
    status: run.status,
    revision: run.revision,
    createdAt: run.created_at,
    snapshotHash: run.snapshot_hash,
    comparisonMode: snapshot.comparisonMode,
    providerRegistryVersion: snapshot.providerRegistryVersion,
    samplesPerAnswer: samplesPerAnswer(snapshot),
    // Owner-only (D-57): which saved key each provider slot uses, so a retry can offer the current key.
    pinnedKeys: await loadPinnedKeys(db, run.id, now),
    configurations: snapshot.configurations.map((c) =>
      isImportedSnapshot(c)
        ? { key: c.key, label: c.label, source: 'imported' as const, provider: null, modelId: null, provenance: c.provenance }
        : { key: c.key, label: c.label, source: 'generated' as const, provider: c.provider, modelId: c.modelId, provenance: null },
    ),
    cases: snapshot.cases.map((c) => ({ key: c.key, title: c.title })),
    imported: importedOutputs.map((output) => ({ caseKey: output.case_key, configurationKey: output.configuration_key })),
    generations: generations.map((generation) => {
      const last = attempts.filter((attempt) => attempt.generation_id === generation.id).at(-1)
      return {
        id: generation.id,
        caseKey: generation.case_key,
        configurationKey: generation.configuration_key,
        sampleNo: generation.sample_no,
        status: generation.status,
        attemptCount: generation.attempt_count,
        errorCode: generation.last_error_code,
        retryable: canRun('retry', run.status) && isRetryable(generation.status, generation.attempt_count, LIMITS.maxAttemptsPerGeneration),
        durationMs: last?.duration_ms ?? null,
        queueWaitMs: last?.queue_wait_ms ?? null,
      }
    }),
    counts: { planned: generations.length, ...counts },
    eligibility: { caseKeys: manifest.caseKeys, excludedCaseKeys: manifest.excludedCaseKeys, frozen: run.eligible_manifest_json !== null },
    review: {
      openedAt: run.review_opened_at,
      revealedAt: run.revealed_at,
      ownerSessionId: sessions.find((session) => session.context_type === 'owner')?.id ?? null,
      // Participation only: never drafts or ratings before reveal.
      participants: sessions.map((session) => ({
        id: session.id,
        label: session.context_type === 'owner' ? 'You (judge, context-aware)' : `Juror ${++invitedIndex}`,
        // Owner-only (D-41): a guest's chosen name and live device count. Never shown to other jurors.
        guest: guests.has(session.reviewer_user_id) ? guests.get(session.reviewer_user_id)! : null,
        contextType: session.context_type,
        status: session.status,
        submittedAt: session.submitted_at,
      })),
      invites: invites.map((invite) => ({
        id: invite.id,
        expiresAt: invite.expires_at,
        state: invite.revoked_at ? 'revoked' : invite.redeemed_at ? 'redeemed' : invite.expires_at <= now ? 'expired' : 'unused',
      })),
      submittedCount: sessions.filter((session) => session.status === 'submitted').length,
      pendingCount: pendingReviewCount(sessions, invites, now),
    },
  }
}

export function pendingReviewCount(
  sessions: ReadonlyArray<{ status: string }>,
  invites: ReadonlyArray<{ expires_at: number; redeemed_at: number | null; revoked_at: number | null }>,
  now: number,
): number {
  const drafts = sessions.filter((session) => session.status === 'draft').length
  const unused = invites.filter((invite) => !invite.redeemed_at && !invite.revoked_at && invite.expires_at > now).length
  return drafts + unused
}

// ---------------------------------------------------------------------------
// Retry, cancel, open review
// ---------------------------------------------------------------------------

export async function retryGenerations(deps: Deps, userId: string, runId: string, input: z.output<typeof retrySchema>, ifMatch: number, key: string, requestId: string) {
  requireGenerationEnabled(deps)
  const access = await loadRunAccess(deps.db, runId, userId)
  requireOwner(access)
  const db = deps.db
  const operation = `run.retry:${runId}`
  const hash = await requestHash(operation, { ...input, ifMatch })

  const result = await idempotent(deps, { actorUserId: userId, idempotencyKey: key, operation, requestHash: hash }, async (receipt) => {
    if (!canRun('retry', access.run.status)) throw stateConflict('Retries are allowed only before review opens.')
    if (access.run.revision !== ifMatch) throw revisionConflict()
    const all_ = await loadGenerations(db, runId)
    const selected = [...new Set(input.generationIds)].map((id) => all_.find((generation) => generation.id === id))
    if (selected.some((generation) => !generation)) throw new ApiError(422, 'VALIDATION_FAILED', 'A selected generation does not belong to this run.')
    const targets = selected as GenerationRow[]
    for (const generation of targets) {
      if (!isRetryable(generation.status, generation.attempt_count, LIMITS.maxAttemptsPerGeneration)) {
        throw stateConflict('Only failed or uncertain generations with an attempt remaining can be retried. Successful outputs are never replaced.')
      }
    }
    const now = deps.now()
    const subjects = budgetSubjects(userId, now)
    const providers = [...new Set(targets.map((generation) => generation.provider))]
    const repins = planRepins(await loadPinnedKeys(db, runId, now), providers, input.credentialIdsByProvider ?? {})
    const response = { status: 202 as const, data: { runId, status: 'generating' as RunStatus, retried: targets.length, repinned: repins.map((repin) => repin.provider) } }
    const outboxIds: string[] = []
    const statements: D1PreparedStatement[] = [
      receipt(response, runId),
      ...repins.flatMap((repin) => repinStatements(db, { runId, evaluationId: access.run.evaluation_id, userId, requestId, now, ...repin })),
      ...reserveBudget(db, subjects, targets.length, deps.config.limits, now),
      ...targets.flatMap((generation) => {
        const attemptNo = generation.attempt_count + 1
        const outboxId = deps.newId()
        outboxIds.push(outboxId)
        return [
          db.prepare(`UPDATE generations SET status = 'pending', attempt_count = ?, last_error_code = NULL, updated_at = ? WHERE id = ?`).bind(attemptNo, now, generation.id),
          db
            .prepare(
              `INSERT INTO attempt_reservations (generation_id, attempt_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?)`,
            )
            .bind(generation.id, attemptNo, subjects.actor, subjects.global, subjects.lifetime, subjects.windowStart, now),
          db.prepare(`INSERT INTO outbox (id, generation_id, attempt_no, status, next_dispatch_at, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)`).bind(outboxId, generation.id, attemptNo, now, now, now),
        ]
      }),
      db.prepare(`UPDATE runs SET status = 'generating', revision = revision + 1, updated_at = ? WHERE id = ?`).bind(now, runId),
      auditStatement(db, { eventType: 'run.retry', requestId, outcome: 'ok', actorUserId: userId, runId, evaluationId: access.run.evaluation_id, metadata: { count: targets.length } }, now),
    ]
    try {
      await runGuarded(
        db,
        'run.retry',
        all(
          cond(`EXISTS (SELECT 1 FROM runs WHERE id = ? AND owner_user_id = ? AND revision = ? AND status IN ('generating','ready'))`, runId, userId, ifMatch),
          ...targets.map((generation) =>
            cond(`EXISTS (SELECT 1 FROM generations WHERE id = ? AND run_id = ? AND status IN ('failed','uncertain') AND attempt_count = ? AND attempt_count < ?)`, generation.id, runId, generation.attempt_count, LIMITS.maxAttemptsPerGeneration),
          ),
          ...providers.map((provider) => {
            const repin = repins.find((candidate) => candidate.provider === provider)
            return repin ? repinAllowed(runId, userId, repin, now) : credentialActive(runId, provider, now)
          }),
          capacity(userId, runId),
        ),
        statements,
      )
    } catch (error) {
      if (error instanceof GuardFailed) {
        const current = await loadRunAccess(db, runId, userId)
        if (current.run.revision !== ifMatch) throw revisionConflict()
        const pins = await loadPinnedKeys(db, runId, deps.now())
        for (const provider of providers) {
          const repin = repins.find((candidate) => candidate.provider === provider)
          if (repin) {
            const chosen = await db
              .prepare(`SELECT 1 AS ok FROM provider_credentials WHERE id = ? AND owner_user_id = ? AND provider = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`)
              .bind(repin.to, userId, provider, deps.now())
              .first()
            if (!chosen) throw new ApiError(409, 'CREDENTIAL_MISSING', `The ${PROVIDER_NAMES[provider]} key you chose was removed or expired. Reload the page and try again.`, { details: { provider } })
          } else if (!pins.find((pin) => pin.provider === provider)?.usable) {
            throw repinRequired(provider)
          }
        }
        throw new ApiError(429, 'RATE_LIMITED', 'Another comparison is already generating. Try again when it finishes.', { retryable: true })
      }
      if (classifyConstraint(error) === 'budget') throw quotaError()
      throw error
    }
    return response
  })
  if (!result.replayed) {
    await dispatchOutbox(deps, runId)
    await notifyRun(deps, runId)
  }
  return result
}

export async function cancelRun(deps: Deps, userId: string, runId: string, _input: z.output<typeof cancelRunSchema>, ifMatch: number, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireOwner(access)
  if (!canRun('cancel', access.run.status)) throw stateConflict('Only generating or ready runs can be canceled. Close review with Reveal instead.')
  const db = deps.db
  const now = deps.now()
  const inRun = 'SELECT id FROM generations WHERE run_id = ?'
  try {
    await runGuarded(
      db,
      'run.cancel',
      cond(`EXISTS (SELECT 1 FROM runs WHERE id = ? AND owner_user_id = ? AND revision = ? AND status IN ('generating','ready'))`, runId, userId, ifMatch),
      [
        ...releaseReservations(db, cond(`r.generation_id IN (${inRun})`, runId), 'reserved', now),
        db.prepare(`UPDATE outbox SET status = 'terminal', last_error_code = 'CANCELED', updated_at = ? WHERE status IN ('pending','dispatched') AND generation_id IN (${inRun})`).bind(now, runId),
        // An in-flight request may still be billed; its late output will be fenced out.
        db.prepare(`UPDATE generation_attempts SET status = 'canceled', error_code = 'CANCELED', finished_at = ? WHERE status = 'running' AND generation_id IN (${inRun})`).bind(now, runId),
        db.prepare(`UPDATE generations SET status = 'canceled', last_error_code = 'CANCELED', updated_at = ? WHERE status IN ('pending','running') AND run_id = ?`).bind(now, runId),
        db.prepare(`UPDATE runs SET status = 'canceled', canceled_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?`).bind(now, now, runId),
        auditStatement(db, { eventType: 'run.cancel', requestId, outcome: 'ok', actorUserId: userId, runId, evaluationId: access.run.evaluation_id }, now),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) throw revisionConflict()
    throw error
  }
  await notifyRun(deps, runId)
  return { runId, status: 'canceled' as RunStatus, revision: ifMatch + 1 }
}

/** Fisher–Yates with cryptographic randomness (spec §6.3). */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const bound = i + 1
    const limit = Math.floor(0x1_0000_0000 / bound) * bound
    let value: number
    do value = crypto.getRandomValues(new Uint32Array(1))[0]
    while (value >= limit) // rejection sampling avoids modulo bias
    const j = value % bound
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export interface AssignmentCase {
  caseKey: string
  responses: Array<{ responseId: string; label: 'A' | 'B' | 'C'; generationId: string | null; acceptedAttemptId: string | null; importedOutputId?: string; configurationKey: string }>
}

export function buildAssignment(manifest: EligibleManifest, newId: () => string): AssignmentCase[] {
  const labels = ['A', 'B', 'C'] as const
  return manifest.caseKeys.map((caseKey) => ({
    caseKey,
    responses: shuffle(manifest.entries.filter((entry) => entry.caseKey === caseKey)).map((entry, index) => ({
      responseId: newId(),
      label: labels[index],
      generationId: entry.generationId,
      acceptedAttemptId: entry.acceptedAttemptId,
      ...(entry.importedOutputId ? { importedOutputId: entry.importedOutputId } : {}),
      configurationKey: entry.configurationKey,
    })),
  }))
}

export function insertSessionStatement(db: D1Database, session: { id: string; runId: string; userId: string; contextType: 'invited' | 'owner'; assignment: AssignmentCase[]; now: number }) {
  return db
    .prepare(
      `INSERT INTO review_sessions (id, run_id, reviewer_user_id, context_type, status, assignment_json, ratings_json, revision, joined_at)
       VALUES (?, ?, ?, ?, 'draft', ?, '[]', 1, ?)`,
    )
    .bind(session.id, session.runId, session.userId, session.contextType, JSON.stringify(session.assignment), session.now)
}

export async function openReview(deps: Deps, userId: string, runId: string, acknowledgeExcludedCases: boolean, ifMatch: number, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireOwner(access)
  if (!canRun('openReview', access.run.status)) throw stateConflict('Review can open only when every generation has finished.')
  if (access.run.revision !== ifMatch) throw revisionConflict()
  const db = deps.db
  const snapshot = parseSnapshot(access.run.snapshot_json)
  const manifest = computeEligibility(snapshot, await loadGenerations(db, runId), await loadImportedOutputs(db, runId))
  if (manifest.caseKeys.length === 0) {
    throw stateConflict('No case has a successful response from every configuration, so there is nothing comparable to review. Retry failures or cancel the run.')
  }
  if (manifest.excludedCaseKeys.length > 0 && !acknowledgeExcludedCases) {
    throw stateConflict('Acknowledge the excluded cases to open review.', { excludedCaseKeys: manifest.excludedCaseKeys })
  }
  let sessionId: string
  try {
    sessionId = await commitOpenReview(deps, { id: runId, ownerUserId: userId, evaluationId: access.run.evaluation_id, revision: ifMatch }, manifest, requestId, false)
  } catch (error) {
    if (error instanceof GuardFailed) throw revisionConflict()
    throw error
  }
  await notifyRun(deps, runId)
  return { runId, status: 'reviewing' as RunStatus, revision: ifMatch + 1, eligibleCaseCount: manifest.caseKeys.length, excludedCaseCount: manifest.excludedCaseKeys.length, ownerSessionId: sessionId }
}

/**
 * Open deliberation without a judge's click once every planned answer has
 * arrived (every sample of every repeat, D-65): every question is comparable,
 * so there is nothing to acknowledge. A hearing with any failed, uncertain or missing answer stays
 * `ready` for the judge to retry or to open with exclusions. The audit row is
 * the usual `review.open`, with no actor and `automatic: true`. Returns
 * whether it opened; a lost race (cancel, delete, another opener) is not an
 * error. The caller publishes the notice.
 */
export async function autoOpenReview(deps: Deps, runId: string, requestId: string): Promise<boolean> {
  const db = deps.db
  const run = await db
    .prepare(`SELECT r.owner_user_id, r.evaluation_id, r.revision, r.status, r.snapshot_json FROM runs r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = ? AND e.deleted_at IS NULL`)
    .bind(runId)
    .first<{ owner_user_id: string; evaluation_id: string; revision: number; status: RunStatus; snapshot_json: string }>()
  if (!run || !canRun('openReview', run.status)) return false
  const generations = await loadGenerations(db, runId)
  // With repeats a question can be eligible while one of its samples failed; that still waits for the judge.
  if (generations.some((generation) => generation.status !== 'succeeded')) return false
  const manifest = computeEligibility(parseSnapshot(run.snapshot_json), generations, await loadImportedOutputs(db, runId))
  if (manifest.caseKeys.length === 0 || manifest.excludedCaseKeys.length > 0) return false
  try {
    await commitOpenReview(deps, { id: runId, ownerUserId: run.owner_user_id, evaluationId: run.evaluation_id, revision: run.revision }, manifest, requestId, true)
    return true
  } catch (error) {
    if (error instanceof GuardFailed) return false
    throw error
  }
}

/** ready → reviewing with the frozen manifest and the judge's own session. Throws GuardFailed when the run moved on. */
async function commitOpenReview(deps: Deps, run: { id: string; ownerUserId: string; evaluationId: string; revision: number }, manifest: EligibleManifest, requestId: string, automatic: boolean): Promise<string> {
  const db = deps.db
  const now = deps.now()
  const sessionId = deps.newId()
  await runGuarded(
    db,
    'run.open_review',
    all(
      cond(
        `EXISTS (SELECT 1 FROM runs r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = ? AND r.owner_user_id = ? AND r.revision = ? AND r.status = 'ready' AND e.deleted_at IS NULL)`,
        run.id,
        run.ownerUserId,
        run.revision,
      ),
      // Recheck the frozen evidence at commit time.
      ...manifest.entries.map((entry) =>
        entry.importedOutputId
          ? cond('EXISTS (SELECT 1 FROM run_imported_outputs WHERE id = ? AND run_id = ?)', entry.importedOutputId, run.id)
          : cond(`EXISTS (SELECT 1 FROM generations WHERE id = ? AND status = 'succeeded' AND accepted_attempt_id = ?)`, entry.generationId, entry.acceptedAttemptId),
      ),
    ),
    [
      db
        .prepare(`UPDATE runs SET status = 'reviewing', eligible_manifest_json = ?, review_opened_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
        .bind(JSON.stringify(manifest), now, now, run.id),
      insertSessionStatement(db, { id: sessionId, runId: run.id, userId: run.ownerUserId, contextType: 'owner', assignment: buildAssignment(manifest, deps.newId), now }),
      auditStatement(
        db,
        {
          eventType: 'review.open',
          requestId,
          outcome: 'ok',
          actorUserId: automatic ? null : run.ownerUserId,
          runId: run.id,
          evaluationId: run.evaluationId,
          metadata: { eligible: manifest.caseKeys.length, excluded: manifest.excludedCaseKeys.length, automatic },
        },
        now,
      ),
    ],
  )
  return sessionId
}

