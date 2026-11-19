/**
 * Accountless jurors (D-41). A guest joins from an invitation link with only a
 * display name. They become a "juror principal" whose review session uses the
 * synthetic reviewer ID `mcj_<principalId>`, so every existing guard,
 * projection, and scorer applies unchanged. Access is a per-device cookie
 * (`__Host-mcj-<runId>`) holding `<deviceId>.<secret>`; a one-time resume link
 * adds a device. Secrets are only ever stored as SHA-256 hashes.
 */

import { z } from 'zod'
import { LIMITS } from '../../domain/limits'
import { codePointLength, hasDisallowedControlChars } from '../../domain/text'
import type { RunStatus } from '../../domain/transitions'
import { all, auditStatement, classifyConstraint, cond, GuardFailed, hitRateLimitWindow, runGuarded } from '../db/sql'
import type { Deps, VerifiedCaller } from '../deps'
import { ApiError } from '../http'
import { notifyRun } from './generation'
import { hashInviteToken } from './reviews'
import { buildAssignment, insertSessionStatement, sessionCount, type EligibleManifest } from './runs'

export const GUEST_PREFIX = 'mcj_'
export const GUEST_COOKIE_PREFIX = '__Host-mcj-'
export const GUEST_COOKIE_MAX_AGE_S = 14 * 24 * 60 * 60
const MAX_DEVICES = 3
/** A device stops working this long after it was added, whatever the browser keeps. */
const DEVICE_LIFETIME_MS = GUEST_COOKIE_MAX_AGE_S * 1000
const HOUR = 60 * 60 * 1000

export const guestRedeemSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid invitation token'),
  displayName: z
    .string()
    .trim()
    .refine((value) => codePointLength(value) >= 1 && codePointLength(value) <= 40, 'Use a name of 1–40 characters')
    .refine((value) => !hasDisallowedControlChars(value), 'The name contains control characters'),
})

export const guestResumeSchema = z.strictObject({
  resume: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid resume link'),
})

export function isGuestId(userId: string): boolean {
  return userId.startsWith(GUEST_PREFIX)
}

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// A wrapper, not an alias: the modules import each other, so resolve the binding at call time.
const sha256 = (value: string) => hashInviteToken(value)

/** Rate-limit subject for a client IP. The raw IP is never stored: an HMAC with the app's request key, or a salted hash. */
async function ipSubject(deps: Deps, ip: string | null, scope: string): Promise<string | null> {
  if (!ip) return null
  const value = ip
  const key = deps.config.hmacKey
  if (key) {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)))
    return `${scope}:ip:${[...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
  }
  return `${scope}:ip:${(await sha256(`${deps.config.appId}:${value}`)).slice(0, 32)}`
}

async function limit(deps: Deps, subject: string | null, max: number, windowMs: number, message: string) {
  if (!subject) return
  const result = await hitRateLimitWindow(deps.db, subject, max, windowMs, deps.now())
  if (!result.allowed) throw new ApiError(429, 'RATE_LIMITED', message, { retryAfterSeconds: result.retryAfterSeconds })
}

const inviteUnavailable = () => new ApiError(409, 'INVITE_UNAVAILABLE', 'This invitation is no longer available. Ask the judge for a new one.')

export interface GuestGrant {
  runId: string
  /** `<deviceId>.<secret>`: goes only into the HttpOnly cookie. */
  cookieValue: string
  /** Shown once to the guest as a link fragment; never logged. */
  resumeSecret?: string
}

export async function redeemInviteAsGuest(deps: Deps, input: z.output<typeof guestRedeemSchema>, ip: string | null, requestId: string, signedInUserId: string | null = null): Promise<GuestGrant> {
  await limit(deps, await ipSubject(deps, ip, 'guest-redeem'), 10, HOUR, 'Too many attempts to join. Try again later.')
  const db = deps.db
  const invite = await db
    .prepare(
      `SELECT i.id, i.run_id, i.expires_at, i.redeemed_at, i.revoked_at, r.status, r.eligible_manifest_json, r.evaluation_id
       FROM invites i JOIN runs r ON r.id = i.run_id JOIN evaluations e ON e.id = r.evaluation_id
       WHERE i.token_hash = ? AND e.deleted_at IS NULL`,
    )
    .bind(await sha256(input.token))
    .first<{ id: string; run_id: string; expires_at: number; redeemed_at: number | null; revoked_at: number | null; status: RunStatus; eligible_manifest_json: string | null; evaluation_id: string }>()
  const now = deps.now()
  if (!invite || invite.redeemed_at || invite.revoked_at || invite.expires_at <= now || invite.status !== 'reviewing' || !invite.eligible_manifest_json) throw inviteUnavailable()
  if (signedInUserId) {
    const seated = await db
      .prepare(`SELECT 1 AS ok FROM runs WHERE id = ? AND owner_user_id = ? UNION SELECT 1 FROM review_sessions WHERE run_id = ? AND reviewer_user_id = ? AND status <> 'revoked'`)
      .bind(invite.run_id, signedInUserId, invite.run_id, signedInUserId)
      .first()
    if (seated) throw new ApiError(409, 'INVITE_UNAVAILABLE', 'You already take part in this hearing with your account, so you cannot also join as a guest.')
  }

  const manifest = JSON.parse(invite.eligible_manifest_json) as EligibleManifest
  const rotation = await sessionCount(db, invite.run_id)
  const principalId = deps.newId()
  const deviceId = deps.newId()
  const deviceSecret = newSecret()
  const resumeSecret = newSecret()
  const reviewerId = `${GUEST_PREFIX}${principalId}`
  try {
    // The same guards as a signed-in redemption: unused, unexpired, review open, and a free slot.
    await runGuarded(
      db,
      'invite.redeem_guest',
      all(
        cond(`EXISTS (SELECT 1 FROM invites WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?)`, invite.id, now),
        cond(`EXISTS (SELECT 1 FROM runs r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = ? AND r.status = 'reviewing' AND e.deleted_at IS NULL)`, invite.run_id),
        cond(`(SELECT COUNT(*) FROM review_sessions WHERE run_id = ? AND context_type = 'invited' AND status <> 'revoked') < ?`, invite.run_id, LIMITS.invitedReviewersPerRun),
      ),
      [
        db.prepare(`UPDATE invites SET redeemed_by = ?, redeemed_at = ? WHERE id = ?`).bind(reviewerId, now, invite.id),
        db
          .prepare(`INSERT INTO juror_principals (id, run_id, invite_id, display_name, resume_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(principalId, invite.run_id, invite.id, input.displayName, await sha256(resumeSecret), now),
        db.prepare(`INSERT INTO juror_devices (id, principal_id, secret_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`).bind(deviceId, principalId, await sha256(deviceSecret), now, now),
        insertSessionStatement(db, { id: deps.newId(), runId: invite.run_id, userId: reviewerId, contextType: 'invited', assignment: buildAssignment(manifest, deps.newId, rotation), now }),
        // IDs only: never the display name, token, or secrets.
        auditStatement(db, { eventType: 'invite.redeem_guest', requestId, outcome: 'ok', actorUserId: reviewerId, runId: invite.run_id, evaluationId: invite.evaluation_id }, now),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) throw inviteUnavailable()
    if (classifyConstraint(error) === 'session_unique') throw inviteUnavailable()
    throw error
  }
  await notifyRun(deps, invite.run_id)
  return { runId: invite.run_id, cookieValue: `${deviceId}.${deviceSecret}`, resumeSecret }
}

/** Add a device from a resume link. Works only while review is open and the juror is still seated. */
export async function resumeGuest(deps: Deps, input: z.output<typeof guestResumeSchema>, ip: string | null, requestId: string, cookieHeader: string | undefined = undefined): Promise<GuestGrant> {
  await limit(deps, await ipSubject(deps, ip, 'guest-resume'), 5, HOUR, 'Too many attempts to resume. Try again later.')
  const db = deps.db
  const principal = await db
    .prepare(
      `SELECT p.id, p.run_id, p.revoked_at, r.status, s.status AS session_status FROM juror_principals p JOIN runs r ON r.id = p.run_id
       LEFT JOIN review_sessions s ON s.run_id = p.run_id AND s.reviewer_user_id = ('${GUEST_PREFIX}' || p.id)
       WHERE p.resume_hash = ?`,
    )
    .bind(await sha256(input.resume))
    .first<{ id: string; run_id: string; revoked_at: number | null; status: RunStatus; session_status: string | null }>()
  const unavailable = new ApiError(409, 'INVITE_UNAVAILABLE', 'This resume link no longer works. Ask the judge if you still need access.')
  if (!principal || principal.revoked_at || principal.status !== 'reviewing' || !principal.session_status || principal.session_status === 'revoked') throw unavailable
  await limit(deps, `guest-resume:p:${principal.id}`, 5, HOUR, 'Too many attempts to resume. Try again later.')
  // A link received from someone else must not silently move this browser into their seat.
  const existing = await verifyGuestCookie(deps, principal.run_id, readCookie(cookieHeader, `${GUEST_COOKIE_PREFIX}${principal.run_id}`))
  if (existing && existing.userId !== `${GUEST_PREFIX}${principal.id}`) {
    throw new ApiError(409, 'INVITE_UNAVAILABLE', 'This browser is already seated as a different juror in this hearing. This resume link belongs to someone else.')
  }
  const now = deps.now()
  const deviceId = deps.newId()
  const deviceSecret = newSecret()
  const nextResume = newSecret()
  const oldHash = await sha256(input.resume)
  try {
    await runGuarded(
      db,
      'guest.resume',
      all(
        // The link is used up here; a fresh one is returned to this device only.
        cond(`EXISTS (SELECT 1 FROM juror_principals WHERE id = ? AND revoked_at IS NULL AND resume_hash = ?)`, principal.id, oldHash),
        cond(`(SELECT COUNT(*) FROM juror_devices WHERE principal_id = ? AND revoked_at IS NULL) < ${MAX_DEVICES}`, principal.id),
      ),
      [
        db.prepare(`INSERT INTO juror_devices (id, principal_id, secret_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`).bind(deviceId, principal.id, await sha256(deviceSecret), now, now),
        db.prepare('UPDATE juror_principals SET resume_hash = ? WHERE id = ?').bind(await sha256(nextResume), principal.id),
        auditStatement(db, { eventType: 'guest.resume', requestId, outcome: 'ok', actorUserId: `${GUEST_PREFIX}${principal.id}`, runId: principal.run_id }, now),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) throw new ApiError(409, 'INVITE_UNAVAILABLE', `This juror already uses ${MAX_DEVICES} devices. Ask the judge to sign the others out.`)
    throw error
  }
  return { runId: principal.run_id, cookieValue: `${deviceId}.${deviceSecret}`, resumeSecret: nextResume }
}

/** Routes a guest cookie may reach, with the hearing ID they name. Everything else needs a signed-in account. */
export function guestRoute(method: string, path: string): string | null {
  // Spec 04 §5 (D-89): exactly one more pattern, the hearing's document of one question (a UUID), read-only.
  const document = /\/runs\/([0-9a-f-]{36})\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(path)
  if (document) return method === 'GET' ? document[1] : null
  const match = /\/runs\/([0-9a-f-]{36})(\/review|\/review\/submit|\/results)?$/.exec(path)
  if (!match) return null
  const tail = match[2] ?? ''
  const allowed = (tail === '' && method === 'GET') || (tail === '/review' && (method === 'GET' || method === 'PUT')) || (tail === '/review/submit' && method === 'POST') || (tail === '/results' && method === 'GET')
  return allowed ? match[1] : null
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

/** Verify a device cookie for one hearing. Returns the guest caller, or null (the API then answers 401). */
export async function verifyGuestCookie(deps: Deps, runId: string, value: string | null): Promise<VerifiedCaller | null> {
  if (!value) return null
  const [deviceId, secret, ...rest] = value.split('.')
  if (!deviceId || !secret || rest.length > 0 || !/^[0-9a-f-]{36}$/.test(deviceId)) return null
  const row = await deps.db
    .prepare(
      `SELECT d.secret_hash, d.revoked_at AS device_revoked, p.id AS principal_id, p.run_id, p.revoked_at AS principal_revoked, d.last_seen_at, d.created_at
       FROM juror_devices d JOIN juror_principals p ON p.id = d.principal_id WHERE d.id = ?`,
    )
    .bind(deviceId)
    .first<{ secret_hash: string; device_revoked: number | null; principal_id: string; run_id: string; principal_revoked: number | null; last_seen_at: number; created_at: number }>()
  if (!row || row.device_revoked || row.principal_revoked || row.run_id !== runId) return null
  if (deps.now() - row.created_at > DEVICE_LIFETIME_MS) return null
  if ((await sha256(secret)) !== row.secret_hash) return null
  const now = deps.now()
  if (now - row.last_seen_at > 60_000) await deps.db.prepare('UPDATE juror_devices SET last_seen_at = ? WHERE id = ?').bind(now, deviceId).run()
  return { userId: `${GUEST_PREFIX}${row.principal_id}`, name: null }
}

export function guestCookieHeader(runId: string, value: string): string {
  return `${GUEST_COOKIE_PREFIX}${runId}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${GUEST_COOKIE_MAX_AGE_S}`
}

/** Owner removal of a guest juror (via revokeSession) also revokes the principal and all its devices. */
export function revokeGuestStatements(db: D1Database, reviewerUserId: string, now: number): D1PreparedStatement[] {
  if (!isGuestId(reviewerUserId)) return []
  const principalId = reviewerUserId.slice(GUEST_PREFIX.length)
  return [
    db.prepare('UPDATE juror_principals SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, principalId),
    db.prepare('UPDATE juror_devices SET revoked_at = ? WHERE principal_id = ? AND revoked_at IS NULL').bind(now, principalId),
  ]
}

/** Judge-only: sign out every device of one guest juror on this hearing; the filed or draft worksheet stays. */
export async function signOutGuestDevices(deps: Deps, ownerUserId: string, runId: string, sessionId: string, requestId: string): Promise<void> {
  const session = await deps.db
    .prepare(`SELECT s.reviewer_user_id FROM review_sessions s JOIN runs r ON r.id = s.run_id WHERE s.id = ? AND s.run_id = ? AND r.owner_user_id = ?`)
    .bind(sessionId, runId, ownerUserId)
    .first<{ reviewer_user_id: string }>()
  if (!session || !isGuestId(session.reviewer_user_id)) throw new ApiError(404, 'NOT_FOUND', 'Not found.')
  const now = deps.now()
  await deps.db.batch([
    deps.db.prepare('UPDATE juror_devices SET revoked_at = ? WHERE principal_id = ? AND revoked_at IS NULL').bind(now, session.reviewer_user_id.slice(GUEST_PREFIX.length)),
    auditStatement(deps.db, { eventType: 'guest.sign_out_devices', requestId, outcome: 'ok', actorUserId: ownerUserId, runId }, now),
  ])
}

/** Owner-only display names for guest jurors on one hearing, keyed by reviewer ID. */
export async function guestNames(db: D1Database, runId: string): Promise<Map<string, { name: string; devices: number }>> {
  const rows = (
    await db
      .prepare(`SELECT p.id, p.display_name, (SELECT COUNT(*) FROM juror_devices d WHERE d.principal_id = p.id AND d.revoked_at IS NULL) AS devices FROM juror_principals p WHERE p.run_id = ?`)
      .bind(runId)
      .all<{ id: string; display_name: string; devices: number }>()
  ).results
  return new Map(rows.map((row) => [`${GUEST_PREFIX}${row.id}`, { name: row.display_name, devices: row.devices }]))
}
