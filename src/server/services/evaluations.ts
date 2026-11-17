/**
 * Evaluations and their editable drafts (F02, F03, F20).
 */

import { z } from 'zod'
import { createEvaluationSchema, draftInputSchema, type Draft, type DraftInput } from '../../domain/contracts'
import { makeExampleDraft } from '../../domain/example'
import { LIMITS } from '../../domain/limits'
import { isRouteEnabled, MODEL_ROUTES, type ModelRoute } from '../../domain/registry'
import type { RunStatus } from '../../domain/transitions'
import { loadEvaluationAccess, requireOwner, type EvaluationRow } from '../access'
import { auditStatement, cond, GuardFailed, releaseReservations, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, revisionConflict } from '../http'

export interface EvaluationSummary {
  id: string
  title: string
  role: 'owner' | 'reviewer'
  latestRunStatus: RunStatus | null
  updatedAt: number
}

function defaultModelKeys(routes: readonly ModelRoute[]): [string, string] {
  const openai = routes.find((route) => route.provider === 'openai' && isRouteEnabled(route)) ?? routes.find((r) => r.provider === 'openai')
  const anthropic = routes.find((route) => route.provider === 'anthropic' && isRouteEnabled(route)) ?? routes.find((r) => r.provider === 'anthropic')
  return [openai?.key ?? MODEL_ROUTES[0].key, anthropic?.key ?? MODEL_ROUTES[1].key]
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
           (SELECT r.status FROM runs r WHERE r.evaluation_id = e.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_run_status
         FROM evaluations e WHERE e.owner_user_id = ?1 AND e.deleted_at IS NULL
         UNION ALL
         SELECT e.id, e.title, 'reviewer' AS role, MAX(s.joined_at) AS updated_at,
           (SELECT r2.status FROM runs r2 JOIN review_sessions s2 ON s2.run_id = r2.id
             WHERE r2.evaluation_id = e.id AND s2.reviewer_user_id = ?1 AND s2.context_type = 'invited' AND s2.status <> 'revoked'
             ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1) AS latest_run_status
         FROM evaluations e
           JOIN runs r ON r.evaluation_id = e.id
           JOIN review_sessions s ON s.run_id = r.id
         WHERE s.reviewer_user_id = ?1 AND s.context_type = 'invited' AND s.status <> 'revoked' AND e.deleted_at IS NULL AND e.owner_user_id <> ?1
         GROUP BY e.id
       )
       SELECT * FROM visible v
       WHERE (?2 IS NULL OR v.updated_at < ?2 OR (v.updated_at = ?2 AND v.id < ?3))
       ORDER BY v.updated_at DESC, v.id DESC LIMIT ?4`,
    )
    .bind(userId, after?.[0] ?? null, after?.[1] ?? null, pageSize + 1)
    .all<{ id: string; title: string; role: 'owner' | 'reviewer'; updated_at: number; latest_run_status: RunStatus | null }>()
  const page = rows.results.slice(0, pageSize)
  const items: EvaluationSummary[] = page.map((row) => ({
    id: row.id,
    title: row.title,
    role: row.role,
    latestRunStatus: row.latest_run_status,
    updatedAt: row.updated_at,
  }))
  const last = page.at(-1)
  return { items, nextCursor: rows.results.length > pageSize && last ? encodeCursor(last.updated_at, last.id) : null }
}

export async function createEvaluation(deps: Deps, userId: string, input: z.output<typeof createEvaluationSchema>, requestId: string) {
  const now = deps.now()
  const id = deps.newId()
  const draft: Draft = { schemaVersion: 1, ...makeExampleDraft(deps.newId, defaultModelKeys(deps.routes)) }
  try {
    await runGuarded(
      deps.db,
      'evaluation.create',
      cond('(SELECT COUNT(*) FROM evaluations WHERE owner_user_id = ? AND deleted_at IS NULL) < ?', userId, LIMITS.ownEvaluationsPerUser),
      [
        deps.db
          .prepare(
            `INSERT INTO evaluations (id, owner_user_id, title, task_description, draft_json, revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, userId, input.title, input.taskDescription, JSON.stringify(draft), now, now),
        auditStatement(deps.db, { eventType: 'evaluation.create', requestId, outcome: 'ok', actorUserId: userId, evaluationId: id }, now),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) {
      throw new ApiError(429, 'QUOTA_EXHAUSTED', `You can keep up to ${LIMITS.ownEvaluationsPerUser} evaluations. Delete one to create another.`)
    }
    throw error
  }
  return { id, revision: 1, draft }
}

export function parseStoredDraft(row: Pick<EvaluationRow, 'draft_json'>): Draft {
  const raw = JSON.parse(row.draft_json) as Draft
  const parsed = draftInputSchema.safeParse({ comparisonMode: raw.comparisonMode, cases: raw.cases, configurations: raw.configurations })
  if (!parsed.success) throw new ApiError(500, 'INTERNAL', 'Stored draft failed validation.')
  return { schemaVersion: 1, ...parsed.data }
}

export async function getEvaluation(deps: Deps, userId: string, evaluationId: string) {
  const { evaluation, role } = await loadEvaluationAccess(deps.db, evaluationId, userId)
  if (role === 'owner') {
    const runs = await deps.db
      .prepare('SELECT id, status, revision, created_at FROM runs WHERE evaluation_id = ? ORDER BY created_at DESC, id DESC')
      .bind(evaluationId)
      .all<{ id: string; status: RunStatus; revision: number; created_at: number }>()
    return {
      id: evaluation.id,
      role,
      title: evaluation.title,
      taskDescription: evaluation.task_description,
      revision: evaluation.revision,
      draft: parseStoredDraft(evaluation),
      runs: runs.results.map((run) => ({ id: run.id, status: run.status, revision: run.revision, createdAt: run.created_at })),
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

export async function saveDraft(deps: Deps, userId: string, evaluationId: string, input: DraftInput, ifMatch: number) {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  requireOwner(access)
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
