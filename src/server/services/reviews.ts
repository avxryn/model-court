/**
 * Invitations, blind review sessions, and reveal (F09–F13; spec §6.3, §9.3).
 *
 * Reviewer projections are explicit allowlists. Generation IDs, attempt IDs,
 * configuration keys, provider/model identity, usage, latency, finish reasons,
 * and other reviewers' ratings never leave this module before reveal.
 */

import { z } from 'zod'
import { toHex } from '../../domain/canonical'
import { saveRatingsSchema, type DraftRating } from '../../domain/contracts'
import { LIMITS } from '../../domain/limits'
import { draftRatingIssues, RUBRIC_VERSION, submissionIssues, type RubricVersion } from '../../domain/rubric'
import { canRun, type RunStatus } from '../../domain/transitions'
import { loadRunAccess, requireOwner, type SessionRow } from '../access'
import { all, auditStatement, classifyConstraint, cond, GuardFailed, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, notFound, revisionConflict, stateConflict } from '../http'
import { idempotent, requestHash } from '../receipts'
import { notifyRun } from './generation'
import { buildAssignment, insertSessionStatement, parseSnapshot, pendingReviewCount, type AssignmentCase, type EligibleManifest } from './runs'

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashInviteToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}

const activeInviteSlots = (runId: string, now: number) =>
  cond(
    `(SELECT COUNT(*) FROM review_sessions WHERE run_id = ? AND context_type = 'invited' AND status <> 'revoked')
     + (SELECT COUNT(*) FROM invites WHERE run_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?) < ?`,
    runId,
    runId,
    now,
    LIMITS.invitedReviewersPerRun,
  )

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function createInvite(deps: Deps, userId: string, runId: string, origin: string, key: string, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireOwner(access)
  const operation = `invite.create:${runId}`
  const result = await idempotent(deps, { actorUserId: userId, idempotencyKey: key, operation, requestHash: await requestHash(operation, {}) }, async (receipt) => {
    if (!canRun('invite', access.run.status)) throw stateConflict('Invitations can be created while the run is ready or reviewing.')
    const now = deps.now()
    const inviteId = deps.newId()
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32))) // 256 bits
    const expiresAt = now + LIMITS.inviteTtlMs
    // The secret lives only in the URL fragment, never in server logs or receipts.
    const response = { status: 201 as const, data: { inviteId, url: `${deps.config.publicOrigin ?? origin}/join#token=${token}`, expiresAt, requiresReissue: false } }
    try {
      await runGuarded(
        deps.db,
        'invite.create',
        all(cond(`EXISTS (SELECT 1 FROM runs WHERE id = ? AND owner_user_id = ? AND status IN ('ready','reviewing'))`, runId, userId), activeInviteSlots(runId, now)),
        [
          deps.db.prepare(`INSERT INTO invites (id, run_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`).bind(inviteId, runId, await hashInviteToken(token), expiresAt, now),
          auditStatement(deps.db, { eventType: 'invite.create', requestId, outcome: 'ok', actorUserId: userId, runId, evaluationId: access.run.evaluation_id }, now),
          receipt(response, inviteId, { inviteId, url: null, expiresAt, requiresReissue: true }),
        ],
      )
    } catch (error) {
      if (error instanceof GuardFailed) {
        throw stateConflict(`A run can have at most ${LIMITS.invitedReviewersPerRun} invited reviewers, counting unused invitations. Revoke an unused invitation first.`)
      }
      throw error
    }
    return response
  })
  return result
}

export async function revokeInvite(deps: Deps, userId: string, runId: string, inviteId: string, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireOwner(access)
  const now = deps.now()
  const result = await deps.db
    .prepare(`UPDATE invites SET revoked_at = ? WHERE id = ? AND run_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL`)
    .bind(now, inviteId, runId)
    .run()
  if (result.meta.changes !== 1) {
    const invite = await deps.db.prepare('SELECT redeemed_at, revoked_at FROM invites WHERE id = ? AND run_id = ?').bind(inviteId, runId).first<{ redeemed_at: number | null; revoked_at: number | null }>()
    if (!invite) throw notFound()
    if (invite.redeemed_at) throw stateConflict('A redeemed invitation cannot be revoked. Remove the reviewer’s unsubmitted session instead.')
    return
  }
  await deps.db.batch([auditStatement(deps.db, { eventType: 'invite.revoke', requestId, outcome: 'ok', actorUserId: userId, runId }, now)])
}

const inviteUnavailable = () => new ApiError(409, 'INVITE_UNAVAILABLE', 'This invitation is expired, already used, or no longer available.')

export async function redeemInvite(deps: Deps, userId: string, token: string, requestId: string) {
  const db = deps.db
  const tokenHash = await hashInviteToken(token)
  const invite = await db
    .prepare(
      `SELECT i.id, i.run_id, i.expires_at, i.redeemed_by, i.redeemed_at, i.revoked_at, r.owner_user_id, r.status, r.eligible_manifest_json, r.evaluation_id
       FROM invites i JOIN runs r ON r.id = i.run_id JOIN evaluations e ON e.id = r.evaluation_id
       WHERE i.token_hash = ? AND e.deleted_at IS NULL`,
    )
    .bind(tokenHash)
    .first<{ id: string; run_id: string; expires_at: number; redeemed_by: string | null; redeemed_at: number | null; revoked_at: number | null; owner_user_id: string; status: RunStatus; eligible_manifest_json: string | null; evaluation_id: string }>()
  if (!invite) throw inviteUnavailable()
  if (invite.redeemed_by === userId) {
    // Same user replaying their own redemption: return their existing session.
    const session = await db.prepare(`SELECT id, status FROM review_sessions WHERE run_id = ? AND reviewer_user_id = ?`).bind(invite.run_id, userId).first<{ id: string; status: string }>()
    if (session && session.status !== 'revoked') return { runId: invite.run_id, sessionId: session.id }
    throw inviteUnavailable()
  }
  if (invite.owner_user_id === userId) throw new ApiError(409, 'INVITE_UNAVAILABLE', 'You are the judge of this evaluation. Use your own review instead of an invitation.')
  const now = deps.now()
  if (invite.redeemed_at || invite.revoked_at || invite.expires_at <= now || invite.status !== 'reviewing' || !invite.eligible_manifest_json) throw inviteUnavailable()

  const manifest = JSON.parse(invite.eligible_manifest_json) as EligibleManifest
  const sessionId = deps.newId()
  try {
    await runGuarded(
      db,
      'invite.redeem',
      all(
        cond(`EXISTS (SELECT 1 FROM invites WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?)`, invite.id, now),
        cond(`EXISTS (SELECT 1 FROM runs r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = ? AND r.status = 'reviewing' AND e.deleted_at IS NULL)`, invite.run_id),
        // This invite already holds one of the slots; redeeming converts it into a session.
        cond(`(SELECT COUNT(*) FROM review_sessions WHERE run_id = ? AND context_type = 'invited' AND status <> 'revoked') < ?`, invite.run_id, LIMITS.invitedReviewersPerRun),
      ),
      [
        db.prepare(`UPDATE invites SET redeemed_by = ?, redeemed_at = ? WHERE id = ?`).bind(userId, now, invite.id),
        insertSessionStatement(db, { id: sessionId, runId: invite.run_id, userId, contextType: 'invited', assignment: buildAssignment(manifest, deps.newId), now }),
        auditStatement(db, { eventType: 'invite.redeem', requestId, outcome: 'ok', actorUserId: userId, runId: invite.run_id, evaluationId: invite.evaluation_id }, now),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) throw inviteUnavailable()
    if (classifyConstraint(error) === 'session_unique') throw new ApiError(409, 'INVITE_UNAVAILABLE', 'You already have a review session for this run.')
    throw error
  }
  await notifyRun(deps, invite.run_id)
  return { runId: invite.run_id, sessionId }
}

// ---------------------------------------------------------------------------
// Review sessions
// ---------------------------------------------------------------------------

function assignedResponseIds(assignment: AssignmentCase[]): string[] {
  return assignment.flatMap((item) => item.responses.map((response) => response.responseId))
}

async function requireSession(deps: Deps, userId: string, runId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  if (!access.session || access.session.status === 'revoked') throw notFound()
  return { access, session: access.session }
}

export interface AnonymousReview {
  runId: string
  sessionId: string
  sessionRevision: number
  contextType: 'invited' | 'owner'
  sessionStatus: SessionRow['status']
  runStatus: RunStatus
  rubricVersion: RubricVersion
  closedNotice: string | null
  cases: Array<{
    caseKey: string
    title: string
    input: string
    reference: string
    expectedBehavior: string
    responses: Array<{ responseId: string; label: 'A' | 'B' | 'C'; text: string }>
  }>
  ratings: DraftRating[]
}

/** The only reviewer-facing projection of evidence before reveal. */
export async function getReview(deps: Deps, userId: string, runId: string): Promise<AnonymousReview> {
  const { access, session } = await requireSession(deps, userId, runId)
  const snapshot = parseSnapshot(access.run.snapshot_json)
  const assignment = JSON.parse(session.assignment_json) as AssignmentCase[]
  const attemptIds = assignment.flatMap((item) => item.responses.map((response) => response.acceptedAttemptId))
  const outputs = new Map<string, string>()
  if (attemptIds.length > 0) {
    const rows = await deps.db
      .prepare(`SELECT id, output_text FROM generation_attempts WHERE status = 'succeeded' AND id IN (${attemptIds.map(() => '?').join(',')})`)
      .bind(...attemptIds)
      .all<{ id: string; output_text: string }>()
    for (const row of rows.results) outputs.set(row.id, row.output_text)
  }
  const revealed = access.run.status === 'revealed' || access.run.status === 'decided'
  return {
    runId: access.run.id,
    sessionId: session.id,
    sessionRevision: session.revision,
    contextType: session.context_type,
    sessionStatus: session.status,
    runStatus: access.run.status,
    rubricVersion: snapshot.rubricVersion ?? RUBRIC_VERSION,
    closedNotice: revealed && session.status !== 'submitted' ? 'Review closed before submission; your draft was not included.' : null,
    cases: assignment.map((item) => {
      const testCase = snapshot.cases.find((c) => c.key === item.caseKey)
      if (!testCase) throw new ApiError(500, 'INTERNAL', 'Assignment references an unknown case.')
      return {
        caseKey: item.caseKey,
        title: testCase.title,
        input: testCase.input,
        reference: testCase.reference,
        expectedBehavior: testCase.expectedBehavior,
        responses: item.responses.map((response) => ({ responseId: response.responseId, label: response.label, text: outputs.get(response.acceptedAttemptId) ?? '' })),
      }
    }),
    ratings: JSON.parse(session.ratings_json) as DraftRating[],
  }
}

export async function saveReview(deps: Deps, userId: string, runId: string, input: z.output<typeof saveRatingsSchema>, ifMatch: number) {
  const { access, session } = await requireSession(deps, userId, runId)
  if (session.status !== 'draft' || access.run.status !== 'reviewing') throw stateConflict('This review can no longer be edited.')
  const issues = draftRatingIssues(assignedResponseIds(JSON.parse(session.assignment_json) as AssignmentCase[]), input.ratings)
  if (issues.length > 0) throw new ApiError(422, 'VALIDATION_FAILED', 'Ratings reference responses outside your assignment.', { details: { issues } })
  const clue = input.ratings.some((rating) => rating.suspectedIdentityClue) ? 1 : 0
  const result = await deps.db
    .prepare(
      `UPDATE review_sessions SET ratings_json = ?, identity_clue_flag = ?, revision = revision + 1
       WHERE id = ? AND reviewer_user_id = ? AND status = 'draft' AND revision = ?
         AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'reviewing')`,
    )
    .bind(JSON.stringify(input.ratings), clue, session.id, userId, ifMatch, runId)
    .run()
  if (result.meta.changes !== 1) {
    const current = await deps.db.prepare('SELECT status, revision FROM review_sessions WHERE id = ?').bind(session.id).first<{ status: string; revision: number }>()
    if (current?.status === 'draft' && current.revision !== ifMatch) throw revisionConflict()
    throw stateConflict('This review can no longer be edited.')
  }
  return { sessionRevision: ifMatch + 1 }
}

export async function submitReview(deps: Deps, userId: string, runId: string, ifMatch: number, key: string, requestId: string) {
  const { access, session } = await requireSession(deps, userId, runId)
  const operation = `review.submit:${runId}`
  return idempotent(deps, { actorUserId: userId, idempotencyKey: key, operation, requestHash: await requestHash(operation, { ifMatch }) }, async (receipt) => {
    if (session.status !== 'draft' || access.run.status !== 'reviewing') throw stateConflict('This review is closed or already submitted.')
    if (session.revision !== ifMatch) throw revisionConflict()
    const ratings = JSON.parse(session.ratings_json) as DraftRating[]
    const issues = submissionIssues(assignedResponseIds(JSON.parse(session.assignment_json) as AssignmentCase[]), ratings)
    if (issues.length > 0) throw new ApiError(409, 'INCOMPLETE_REVIEW', 'Score every response on every dimension, with a note for any 0, before submitting.', { details: { issues } })
    const now = deps.now()
    const response = { status: 200 as const, data: { sessionId: session.id, status: 'submitted', sessionRevision: ifMatch + 1, submittedAt: now } }
    try {
      await runGuarded(
        deps.db,
        'review.submit',
        all(
          cond(`EXISTS (SELECT 1 FROM review_sessions WHERE id = ? AND reviewer_user_id = ? AND status = 'draft' AND revision = ?)`, session.id, userId, ifMatch),
          // If reveal commits first, this submission is refused and stays out of the cohort.
          cond(`EXISTS (SELECT 1 FROM runs r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = ? AND r.status = 'reviewing' AND e.deleted_at IS NULL)`, runId),
        ),
        [
          deps.db.prepare(`UPDATE review_sessions SET status = 'submitted', submitted_at = ?, revision = revision + 1 WHERE id = ?`).bind(now, session.id),
          auditStatement(deps.db, { eventType: 'review.submit', requestId, outcome: 'ok', actorUserId: userId, runId, evaluationId: access.run.evaluation_id }, now),
          receipt(response, session.id),
        ],
      )
    } catch (error) {
      if (error instanceof GuardFailed) {
        const run = await deps.db.prepare('SELECT status FROM runs WHERE id = ?').bind(runId).first<{ status: string }>()
        if (run?.status !== 'reviewing') throw stateConflict('Review closed before your submission was recorded; your draft was not included.')
        throw revisionConflict()
      }
      throw error
    }
    await notifyRun(deps, runId)
    return response
  })
}

export async function revokeSession(deps: Deps, userId: string, runId: string, sessionId: string, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireOwner(access)
  const now = deps.now()
  const result = await deps.db
    .prepare(
      `UPDATE review_sessions SET status = 'revoked', closed_at = ?
       WHERE id = ? AND run_id = ? AND context_type = 'invited' AND status = 'draft'
         AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'reviewing')`,
    )
    .bind(now, sessionId, runId, runId)
    .run()
  if (result.meta.changes !== 1) {
    const row = await deps.db.prepare('SELECT status FROM review_sessions WHERE id = ? AND run_id = ?').bind(sessionId, runId).first<{ status: string }>()
    if (!row) throw notFound()
    // Removing submitted evidence would allow excluding unfavorable reviews (spec §9.3).
    throw stateConflict('Only an unsubmitted invited session can be removed while review is open.')
  }
  await deps.db.batch([auditStatement(deps.db, { eventType: 'review.revoke_session', requestId, outcome: 'ok', actorUserId: userId, runId }, now)])
  await notifyRun(deps, runId)
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

export async function reveal(deps: Deps, userId: string, runId: string, acknowledgePendingCount: number, ifMatch: number, key: string, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireOwner(access)
  const operation = `run.reveal:${runId}`
  const result = await idempotent(deps, { actorUserId: userId, idempotencyKey: key, operation, requestHash: await requestHash(operation, { acknowledgePendingCount, ifMatch }) }, async (receipt) => {
    if (access.run.status !== 'reviewing') throw stateConflict('Only a run under review can be revealed.')
    if (access.run.revision !== ifMatch) throw revisionConflict()
    const db = deps.db
    const now = deps.now()
    const pendingSql = `(SELECT COUNT(*) FROM review_sessions WHERE run_id = ? AND status = 'draft')
      + (SELECT COUNT(*) FROM invites WHERE run_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?)`
    const response = { status: 200 as const, data: { runId, status: 'revealed' as RunStatus, revision: ifMatch + 1, revealedAt: now } }
    try {
      await runGuarded(
        db,
        'run.reveal',
        all(
          cond(`EXISTS (SELECT 1 FROM runs WHERE id = ? AND owner_user_id = ? AND status = 'reviewing' AND revision = ?)`, runId, userId, ifMatch),
          cond(`(SELECT COUNT(*) FROM review_sessions WHERE run_id = ? AND status = 'submitted') >= 1`, runId),
          cond(`${pendingSql} = ?`, runId, runId, now, acknowledgePendingCount),
        ),
        [
          // The cohort is captured in the same commit that closes review.
          db
            .prepare(
              `UPDATE runs SET status = 'revealed', revealed_at = ?, revision = revision + 1, updated_at = ?,
                 reveal_cohort_json = (SELECT json_group_array(id) FROM (SELECT id FROM review_sessions WHERE run_id = ? AND status = 'submitted' ORDER BY joined_at))
               WHERE id = ?`,
            )
            .bind(now, now, runId, runId),
          db.prepare(`UPDATE review_sessions SET status = 'closed', closed_at = ? WHERE run_id = ? AND status = 'draft'`).bind(now, runId),
          db.prepare(`UPDATE invites SET revoked_at = ? WHERE run_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL`).bind(now, runId),
          auditStatement(db, { eventType: 'run.reveal', requestId, outcome: 'ok', actorUserId: userId, runId, evaluationId: access.run.evaluation_id, metadata: { pendingClosed: acknowledgePendingCount } }, now),
          receipt(response, runId),
        ],
      )
    } catch (error) {
      if (error instanceof GuardFailed) {
        const sessions = (await db.prepare('SELECT status FROM review_sessions WHERE run_id = ?').bind(runId).all<{ status: string }>()).results
        const invites = (await db.prepare('SELECT expires_at, redeemed_at, revoked_at FROM invites WHERE run_id = ?').bind(runId).all<{ expires_at: number; redeemed_at: number | null; revoked_at: number | null }>()).results
        const submitted = sessions.filter((s) => s.status === 'submitted').length
        const pending = pendingReviewCount(sessions, invites, deps.now())
        if (submitted === 0) throw stateConflict('At least one submitted review is required before reveal.')
        if (pending !== acknowledgePendingCount) throw stateConflict('The number of unfinished reviews changed. Confirm the current count.', { pendingCount: pending, submittedCount: submitted })
        throw revisionConflict()
      }
      throw error
    }
    return response
  })
  if (!result.replayed) await notifyRun(deps, runId)
  return result
}
