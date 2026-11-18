/**
 * Evaluations and their editable drafts (F02, F03, F20).
 */

import { z } from 'zod'
import { sha256Hex } from '../../domain/canonical'
import { scenarioHash, scenarioSourceOfDraft } from '../../domain/scenario'
import { createEvaluationSchema, draftInputSchema, isImported, type Draft, type DraftInput, type putImportsSchema } from '../../domain/contracts'
import { utf8ByteLength } from '../../domain/text'
import { defaultModelKeys, makeExampleDraft } from '../../domain/example'
import { LIMITS } from '../../domain/limits'
import type { RunStatus } from '../../domain/transitions'
import { loadEvaluationAccess, requireOwner, type EvaluationRow } from '../access'
import { auditStatement, cond, GuardFailed, releaseReservations, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, revisionConflict } from '../http'
import { caseOrigin, caseVersions } from './scenarios'

export interface EvaluationSummary {
  id: string
  title: string
  role: 'owner' | 'reviewer'
  latestRunStatus: RunStatus | null
  /** The hearing that status belongs to, so a list can link straight to its next step. */
  latestRunId: string | null
  /**
   * Juror progress on the latest hearing, for the judge's row only (null for jurors' rows and cases
   * without a hearing): invited jurors seated, and how many of them have filed.
   */
  jurors: { joined: number; filed: number } | null
  /** Whether the viewer has filed their own worksheet on the latest hearing. */
  viewerFiled: boolean
  updatedAt: number
}

function encodeCursor(updatedAt: number, id: string): string {
  return btoa(JSON.stringify([updatedAt, id])).replace(/=+$/, '')
}

function decodeCursor(cursor: string | undefined): [number, string] | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(atob(cursor)) as unknown
    if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string') return [value[0], value[1]]
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'BAD_REQUEST', 'Invalid cursor.')
}

export async function listEvaluations(deps: Deps, userId: string, cursor: string | undefined, limit: number) {
  const after = decodeCursor(cursor)
  const pageSize = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 50) : 20
  // A reviewer's row reflects only runs they joined: status of their latest joined run,
  // ordered by when they joined — never the owner's other runs or draft edits.
  const rows = await deps.db
    .prepare(
      `WITH visible AS (
         SELECT e.id, e.title, 'owner' AS role, e.updated_at AS updated_at,
           (SELECT r.status FROM runs r WHERE r.evaluation_id = e.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_run_status,
           (SELECT r.id FROM runs r WHERE r.evaluation_id = e.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_run_id
         FROM evaluations e WHERE e.owner_user_id = ?1 AND e.deleted_at IS NULL
         UNION ALL
         SELECT e.id, e.title, 'reviewer' AS role, MAX(s.joined_at) AS updated_at,
           (SELECT r2.status FROM runs r2 JOIN review_sessions s2 ON s2.run_id = r2.id
             WHERE r2.evaluation_id = e.id AND s2.reviewer_user_id = ?1 AND s2.context_type = 'invited' AND s2.status <> 'revoked'
             ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1) AS latest_run_status,
           (SELECT r3.id FROM runs r3 JOIN review_sessions s3 ON s3.run_id = r3.id
             WHERE r3.evaluation_id = e.id AND s3.reviewer_user_id = ?1 AND s3.context_type = 'invited' AND s3.status <> 'revoked'
             ORDER BY r3.created_at DESC, r3.id DESC LIMIT 1) AS latest_run_id
         FROM evaluations e
           JOIN runs r ON r.evaluation_id = e.id
           JOIN review_sessions s ON s.run_id = r.id
         WHERE s.reviewer_user_id = ?1 AND s.context_type = 'invited' AND s.status <> 'revoked' AND e.deleted_at IS NULL AND e.owner_user_id <> ?1
         GROUP BY e.id
       )
       SELECT v.*,
         (SELECT COUNT(*) FROM review_sessions j WHERE j.run_id = v.latest_run_id AND j.context_type = 'invited' AND j.status <> 'revoked') AS jurors_joined,
         (SELECT COUNT(*) FROM review_sessions j WHERE j.run_id = v.latest_run_id AND j.context_type = 'invited' AND j.status <> 'revoked' AND j.submitted_at IS NOT NULL) AS jurors_filed,
         (SELECT COUNT(*) FROM review_sessions m WHERE m.run_id = v.latest_run_id AND m.reviewer_user_id = ?1 AND m.submitted_at IS NOT NULL) AS viewer_filed
       FROM visible v
       WHERE (?2 IS NULL OR v.updated_at < ?2 OR (v.updated_at = ?2 AND v.id < ?3))
       ORDER BY v.updated_at DESC, v.id DESC LIMIT ?4`,
    )
    .bind(userId, after?.[0] ?? null, after?.[1] ?? null, pageSize + 1)
    .all<{ id: string; title: string; role: 'owner' | 'reviewer'; updated_at: number; latest_run_status: RunStatus | null; latest_run_id: string | null; jurors_joined: number; jurors_filed: number; viewer_filed: number }>()
  const page = rows.results.slice(0, pageSize)
  const items: EvaluationSummary[] = page.map((row) => ({
    id: row.id,
    title: row.title,
    role: row.role,
    latestRunStatus: row.latest_run_status,
    latestRunId: row.latest_run_id,
    jurors: row.role === 'owner' && row.latest_run_id ? { joined: Number(row.jurors_joined), filed: Number(row.jurors_filed) } : null,
    viewerFiled: Number(row.viewer_filed) > 0,
    updatedAt: row.updated_at,
  }))
  const last = page.at(-1)
  return { items, nextCursor: rows.results.length > pageSize && last ? encodeCursor(last.updated_at, last.id) : null }
}

export async function createEvaluation(deps: Deps, userId: string, input: z.output<typeof createEvaluationSchema>, requestId: string) {
  const now = deps.now()
  const id = deps.newId()
  // Spec 02 (D-71): an imported scenario starts the case instead of the example, after the same caps as a save.
  if (input.draft) {
    const capError = configurationCapError(deps, input.draft.configurations.length) ?? samplesCapError(deps, input.draft.samplesPerAnswer)
    if (capError) throw capError
  }
  const draft: Draft = { schemaVersion: 1, ...(input.draft ?? makeExampleDraft(deps.newId, defaultModelKeys(deps.routes))) }
  const origin = input.origin && input.draft ? { kind: input.origin.kind, scenarioHash: await scenarioHash(scenarioSourceOfDraft(draft)) } : null
  try {
    await runGuarded(
      deps.db,
      'evaluation.create',
      cond('(SELECT COUNT(*) FROM evaluations WHERE owner_user_id = ? AND deleted_at IS NULL) < ?', userId, LIMITS.ownEvaluationsPerUser),
      [
        deps.db
          .prepare(
            `INSERT INTO evaluations (id, owner_user_id, title, task_description, draft_json, revision, created_at, updated_at, origin_kind, origin_scenario_hash)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          )
          .bind(id, userId, input.title, input.taskDescription, JSON.stringify(draft), now, now, origin?.kind ?? null, origin?.scenarioHash ?? null),
        auditStatement(deps.db, { eventType: 'evaluation.create', requestId, outcome: 'ok', actorUserId: userId, evaluationId: id, ...(origin ? { metadata: { origin: origin.kind } } : {}) }, now),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) {
      throw caseQuotaError()
    }
    throw error
  }
  return { id, revision: 1, draft }
}

export function caseQuotaError(): ApiError {
  return new ApiError(429, 'QUOTA_EXHAUSTED', `You can keep up to ${LIMITS.ownEvaluationsPerUser} evaluations. Delete one to create another.`)
}

export function parseStoredDraft(row: Pick<EvaluationRow, 'draft_json'>): Draft {
  const raw = JSON.parse(row.draft_json) as Draft
  const parsed = draftInputSchema.safeParse({
    comparisonMode: raw.comparisonMode,
    ...(raw.rubricVersion !== undefined ? { rubricVersion: raw.rubricVersion } : {}),
    cases: raw.cases,
    configurations: raw.configurations,
    ...(raw.samplesPerAnswer !== undefined ? { samplesPerAnswer: raw.samplesPerAnswer } : {}),
  })
  if (!parsed.success) throw new ApiError(500, 'INTERNAL', 'Stored draft failed validation.')
  return { schemaVersion: 1, ...parsed.data }
}

export async function getEvaluation(deps: Deps, userId: string, evaluationId: string) {
  const { evaluation, role } = await loadEvaluationAccess(deps.db, evaluationId, userId)
  if (role === 'owner') {
    const runs = await deps.db
      .prepare('SELECT id, status, revision, created_at, snapshot_json FROM runs WHERE evaluation_id = ? ORDER BY created_at DESC, id DESC')
      .bind(evaluationId)
      .all<{ id: string; status: RunStatus; revision: number; created_at: number; snapshot_json: string }>()
    const draft = parseStoredDraft(evaluation)
    // Scenario versions (D-68): computed from the frozen snapshots, owner only.
    const versions = await caseVersions(runs.results, draft)
    return {
      id: evaluation.id,
      role,
      title: evaluation.title,
      taskDescription: evaluation.task_description,
      revision: evaluation.revision,
      draft,
      draftScenarioHash: versions.draftScenarioHash,
      draftScenarioVersion: versions.draftScenarioVersion,
      nextScenarioVersion: versions.nextScenarioVersion,
      draftDiff: versions.draftDiff,
      imports: (
        await deps.db
          .prepare('SELECT configuration_key, case_key, text, text_sha256, byte_length, updated_at FROM evaluation_imports WHERE evaluation_id = ? ORDER BY configuration_key, case_key')
          .bind(evaluationId)
          .all<{ configuration_key: string; case_key: string; text: string; text_sha256: string; byte_length: number; updated_at: number }>()
      ).results.map((row) => ({ configurationKey: row.configuration_key, caseKey: row.case_key, text: row.text, sha256: row.text_sha256, byteLength: row.byte_length, updatedAt: row.updated_at })),
      runs: runs.results.map((run) => ({ id: run.id, status: run.status, revision: run.revision, createdAt: run.created_at, ...versions.byRun.get(run.id)! })),
      // Spec 02 (D-71): where this case came from, and how many live copies were made of it.
      ...(await caseOrigin(deps.db, evaluation)),
      updatedAt: evaluation.updated_at,
    }
  }
  const runs = await deps.db
    .prepare(
      `SELECT r.id, r.status, r.created_at FROM runs r JOIN review_sessions s ON s.run_id = r.id
       WHERE r.evaluation_id = ? AND s.reviewer_user_id = ? AND s.context_type = 'invited' AND s.status <> 'revoked'
       ORDER BY r.created_at DESC`,
    )
    .bind(evaluationId, userId)
    .all<{ id: string; status: RunStatus; created_at: number }>()
  return {
    id: evaluation.id,
    role,
    title: evaluation.title,
    runs: runs.results.map((run) => ({ id: run.id, status: run.status, createdAt: run.created_at })),
  }
}

/** F24: the schema allows up to three configurations; the deployment may cap lower. */
export function configurationCapError(deps: Deps, count: number): ApiError | null {
  const cap = deps.config.maxConfigurationsPerRun
  if (count <= cap) return null
  return new ApiError(422, 'VALIDATION_FAILED', `This deployment allows at most ${cap} configurations per comparison.`, {
    fields: [{ path: 'configurations', message: `At most ${cap} configurations` }],
  })
}

/** D-65: a draft may not ask for more samples per answer than this deployment allows. */
export function samplesCapError(deps: Deps, samples: number | undefined): ApiError | null {
  const cap = deps.config.maxSamplesPerAnswer
  if ((samples ?? 1) <= cap) return null
  return new ApiError(422, 'VALIDATION_FAILED', cap === 1 ? 'Repeats are turned off on this deployment.' : `This deployment allows at most ${cap} samples per answer.`, {
    fields: [{ path: 'samplesPerAnswer', message: cap === 1 ? 'Repeats are off' : `At most ${cap}` }],
  })
}

export async function saveDraft(deps: Deps, userId: string, evaluationId: string, input: DraftInput, ifMatch: number) {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  requireOwner(access)
  const capError = configurationCapError(deps, input.configurations.length) ?? samplesCapError(deps, input.samplesPerAnswer)
  if (capError) throw capError
  const draft: Draft = { schemaVersion: 1, ...input }
  const now = deps.now()
  const result = await deps.db
    .prepare(
      `UPDATE evaluations SET draft_json = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL`,
    )
    .bind(JSON.stringify(draft), now, evaluationId, userId, ifMatch)
    .run()
  if (result.meta.changes !== 1) throw revisionConflict()
  return { revision: ifMatch + 1 }
}

/**
 * Replace one imported party's answers (D-38). The party must be an imported
 * party in the saved draft and every case key must be one of its questions.
 * Bumps the evaluation revision, so a hearing started from an older revision is refused.
 */
export async function putImports(deps: Deps, userId: string, evaluationId: string, configurationKey: string, input: z.output<typeof putImportsSchema>, ifMatch: number, requestId: string) {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  requireOwner(access)
  const draft = parseStoredDraft(access.evaluation)
  const party = draft.configurations.find((configuration) => configuration.key === configurationKey)
  if (!party || !isImported(party)) throw new ApiError(422, 'VALIDATION_FAILED', 'Save the draft with this imported party first.', { fields: [{ path: 'configurationKey', message: 'Not an imported party in the saved draft' }] })
  const caseKeys = new Set(draft.cases.map((testCase) => testCase.key))
  const seen = new Set<string>()
  for (const [index, item] of input.items.entries()) {
    if (!caseKeys.has(item.caseKey) || seen.has(item.caseKey)) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'Each answer must belong to a different question in the saved draft.', { fields: [{ path: `items.${index}.caseKey`, message: 'Unknown or repeated question' }] })
    }
    seen.add(item.caseKey)
  }
  const now = deps.now()
  const db = deps.db
  const rows = await Promise.all(input.items.map(async (item) => ({ ...item, sha256: await sha256Hex(item.text), byteLength: utf8ByteLength(item.text) })))
  try {
    await runGuarded(db, 'evaluation.imports', cond('EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL)', evaluationId, userId, ifMatch), [
      db.prepare('DELETE FROM evaluation_imports WHERE evaluation_id = ? AND configuration_key = ?').bind(evaluationId, configurationKey),
      ...rows.map((row) =>
        db
          .prepare(`INSERT INTO evaluation_imports (evaluation_id, configuration_key, case_key, text, text_sha256, byte_length, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(evaluationId, configurationKey, row.caseKey, row.text, row.sha256, row.byteLength, now, now),
      ),
      db.prepare('UPDATE evaluations SET revision = revision + 1, updated_at = ? WHERE id = ?').bind(now, evaluationId),
      // IDs and counts only; imported text never enters the audit log.
      auditStatement(db, { eventType: 'evaluation.imports', requestId, outcome: 'ok', actorUserId: userId, evaluationId, metadata: { configurationKey, count: rows.length } }, now),
    ])
  } catch (error) {
    if (error instanceof GuardFailed) throw revisionConflict()
    throw error
  }
  return { revision: ifMatch + 1, imports: rows.map((row) => ({ caseKey: row.caseKey, sha256: row.sha256, byteLength: row.byteLength })) }
}

export async function deleteImports(deps: Deps, userId: string, evaluationId: string, configurationKey: string, ifMatch: number, requestId: string) {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  requireOwner(access)
  const now = deps.now()
  const db = deps.db
  try {
    await runGuarded(db, 'evaluation.imports.delete', cond('EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL)', evaluationId, userId, ifMatch), [
      db.prepare('DELETE FROM evaluation_imports WHERE evaluation_id = ? AND configuration_key = ?').bind(evaluationId, configurationKey),
      db.prepare('UPDATE evaluations SET revision = revision + 1, updated_at = ? WHERE id = ?').bind(now, evaluationId),
      auditStatement(db, { eventType: 'evaluation.imports.delete', requestId, outcome: 'ok', actorUserId: userId, evaluationId, metadata: { configurationKey } }, now),
    ])
  } catch (error) {
    if (error instanceof GuardFailed) throw revisionConflict()
    throw error
  }
  return { revision: ifMatch + 1 }
}

/** Tombstone immediately, fence active work, release provably unsent reservations. */
export async function deleteEvaluation(deps: Deps, userId: string, evaluationId: string, confirmTitle: string, ifMatch: number, requestId: string) {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  requireOwner(access)
  if (confirmTitle !== access.evaluation.title) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Type the evaluation title exactly to confirm deletion.', {
      fields: [{ path: 'confirmTitle', message: 'Title does not match' }],
    })
  }
  const now = deps.now()
  const db = deps.db
  const runIds = `SELECT id FROM runs WHERE evaluation_id = ?`
  const pendingGenerations = `SELECT id FROM generations WHERE status = 'pending' AND run_id IN (${runIds})`
  try {
    await runGuarded(
      db,
      'evaluation.delete',
      cond('EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL)', evaluationId, userId, ifMatch),
      [
        ...releaseReservations(db, cond(`r.generation_id IN (${pendingGenerations})`, evaluationId), 'reserved', now),
        db.prepare(`UPDATE outbox SET status = 'terminal', last_error_code = 'DELETED', updated_at = ? WHERE status IN ('pending','dispatched') AND generation_id IN (SELECT id FROM generations WHERE run_id IN (${runIds}))`).bind(now, evaluationId),
        db.prepare(`UPDATE generations SET status = 'canceled', last_error_code = 'DELETED', updated_at = ? WHERE status = 'pending' AND run_id IN (${runIds})`).bind(now, evaluationId),
        db.prepare(`UPDATE runs SET status = 'canceled', canceled_at = ?, updated_at = ?, revision = revision + 1 WHERE evaluation_id = ? AND status IN ('generating','ready')`).bind(now, now, evaluationId),
        // Special master (D-40): queued grader calls were never sent, so their units are released; in-flight ones are fenced out.
        ...releaseReservations(db, cond(`r.grader_item_id IN (SELECT i.id FROM grader_items i JOIN grader_runs g ON g.id = i.grader_run_id WHERE i.status = 'pending' AND g.run_id IN (${runIds}))`, evaluationId), 'reserved', now, 'grader_reservations'),
        db.prepare(`UPDATE grader_outbox SET status = 'terminal', last_error_code = 'DELETED', updated_at = ? WHERE status IN ('pending','dispatched') AND grader_item_id IN (SELECT i.id FROM grader_items i JOIN grader_runs g ON g.id = i.grader_run_id WHERE g.run_id IN (${runIds}))`).bind(now, evaluationId),
        db.prepare(`UPDATE grader_items SET status = 'canceled', last_error_code = 'DELETED', updated_at = ? WHERE status = 'pending' AND grader_run_id IN (SELECT id FROM grader_runs WHERE run_id IN (${runIds}))`).bind(now, evaluationId),
        db.prepare(`UPDATE grader_runs SET status = 'canceled', revision = revision + 1, updated_at = ? WHERE status = 'generating' AND run_id IN (${runIds})`).bind(now, evaluationId),
        db.prepare('UPDATE evaluations SET deleted_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?').bind(now, now, evaluationId),
        auditStatement(db, { eventType: 'evaluation.delete', requestId, outcome: 'tombstoned', actorUserId: userId, evaluationId }, now),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) throw revisionConflict()
    throw error
  }
  return { id: evaluationId, deleted: true, cleanup: 'scheduled_within_24h' }
}
