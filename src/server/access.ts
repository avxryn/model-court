/**
 * Per-evaluation authorization (spec §2.2, §4.5). Every route resolves the
 * caller's role here first. Invisible, deleted, and nonexistent resources all
 * produce the same 404 so IDs cannot be probed.
 */

import type { RunStatus } from '../domain/transitions'
import { forbidden, notFound } from './http'

export interface EvaluationRow {
  id: string
  owner_user_id: string
  title: string
  task_description: string
  draft_json: string
  revision: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface RunRow {
  id: string
  evaluation_id: string
  owner_user_id: string
  status: RunStatus
  snapshot_json: string
  snapshot_hash: string
  revision: number
  eligible_manifest_json: string | null
  review_opened_at: number | null
  revealed_at: number | null
  reveal_cohort_json: string | null
  created_at: number
  updated_at: number
  canceled_at: number | null
}

export interface SessionRow {
  id: string
  run_id: string
  reviewer_user_id: string
  context_type: 'invited' | 'owner'
  status: 'draft' | 'submitted' | 'closed' | 'revoked'
  assignment_json: string
  ratings_json: string
  revision: number
  joined_at: number
  submitted_at: number | null
  closed_at: number | null
  identity_clue_flag: number
}

export type Role = 'owner' | 'reviewer'

export async function loadEvaluationAccess(db: D1Database, evaluationId: string, userId: string): Promise<{ evaluation: EvaluationRow; role: Role }> {
  const evaluation = await db
    .prepare('SELECT * FROM evaluations WHERE id = ? AND deleted_at IS NULL')
    .bind(evaluationId)
    .first<EvaluationRow>()
  if (!evaluation) throw notFound()
  if (evaluation.owner_user_id === userId) return { evaluation, role: 'owner' }
  const membership = await db
    .prepare(
      `SELECT 1 AS ok FROM review_sessions s JOIN runs r ON r.id = s.run_id
       WHERE r.evaluation_id = ? AND s.reviewer_user_id = ? AND s.context_type = 'invited' AND s.status <> 'revoked' LIMIT 1`,
    )
    .bind(evaluationId, userId)
    .first()
  if (!membership) throw notFound()
  return { evaluation, role: 'reviewer' }
}

export interface RunAccess {
  run: RunRow
  evaluation: Pick<EvaluationRow, 'id' | 'title' | 'owner_user_id'>
  role: Role
  /** The caller's own review session, if any (owner or invited). */
  session: SessionRow | null
}

export async function loadRunAccess(db: D1Database, runId: string, userId: string): Promise<RunAccess> {
  const row = await db
    .prepare(
      `SELECT r.*, e.title AS evaluation_title FROM runs r JOIN evaluations e ON e.id = r.evaluation_id
       WHERE r.id = ? AND e.deleted_at IS NULL`,
    )
    .bind(runId)
    .first<RunRow & { evaluation_title: string }>()
  if (!row) throw notFound()
  const { evaluation_title, ...run } = row
  const session = await db
    .prepare('SELECT * FROM review_sessions WHERE run_id = ? AND reviewer_user_id = ?')
    .bind(runId, userId)
    .first<SessionRow>()
  const evaluation = { id: run.evaluation_id, title: evaluation_title, owner_user_id: run.owner_user_id }
  if (run.owner_user_id === userId) return { run, evaluation, role: 'owner', session }
  if (!session || session.status === 'revoked' || session.context_type !== 'invited') throw notFound()
  return { run, evaluation, role: 'reviewer', session }
}

export function requireOwner(access: { role: Role }): void {
  if (access.role !== 'owner') throw forbidden('Only the evaluation owner can do this.')
}
