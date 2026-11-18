/**
 * Personal provider credentials (F26–F28, spec §6.6, §9.6).
 *
 * Plaintext keys exist only inside `saveCredential` (to encrypt),
 * `withRunCredential` (to authorize one provider request) and `checkCredential`
 * (one free list-models request, D-57). They are never
 * logged, stored unencrypted, returned, or placed in receipts or jobs.
 */

import { z } from 'zod'
import { canonicalJson } from '../../domain/canonical'
import { createCredentialSchema } from '../../domain/contracts'
import type { ProviderId } from '../../domain/registry'
import { CredentialCryptoError, hmacHex, openCredential, sealCredential } from '../credential-crypto'
import { all, auditStatement, classifyConstraint, cond, GuardFailed, hitRateLimit, releaseReservations, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, notFound, revisionConflict } from '../http'
import { checkProviderKey, type KeyCheckOutcome, type KeyCheckResult } from '../providers/key-check'
import { idempotent } from '../receipts'

export interface CredentialMetadata {
  id: string
  provider: ProviderId
  label: string
  status: 'active' | 'revoked'
  revision: number
  createdAt: number
  /** The key stops working at this time unless renewed (D-23). */
  expiresAt: number | null
  /** Last time a generation job decrypted this key to call the provider. */
  lastUsedAt: number | null
  /** The owner's run that last used it (owner-only metadata). */
  lastUsedRunId: string | null
  /** Last "Check key" (D-57): a free list-models call made server-side with this key. */
  lastCheckedAt: number | null
  lastCheckResult: KeyCheckResult | null
}

interface CredentialRow {
  id: string
  owner_user_id: string
  provider: ProviderId
  label: string
  ciphertext: string | null
  nonce: string | null
  encryption_key_version: string | null
  status: 'active' | 'revoked'
  revision: number
  created_at: number
  revoked_at: number | null
  expires_at: number | null
  last_used_at: number | null
  last_used_run_id: string | null
  last_checked_at: number | null
  last_check_result: KeyCheckResult | null
}

const SAFE_COLUMNS = 'id, provider, label, status, revision, created_at, expires_at, last_used_at, last_used_run_id, last_checked_at, last_check_result'

type SafeRow = Pick<CredentialRow, 'id' | 'provider' | 'label' | 'status' | 'revision' | 'created_at' | 'expires_at' | 'last_used_at' | 'last_used_run_id' | 'last_checked_at' | 'last_check_result'>

function toMetadata(row: SafeRow): CredentialMetadata {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastUsedRunId: row.last_used_run_id,
    lastCheckedAt: row.last_checked_at,
    lastCheckResult: row.last_check_result,
  }
}

export async function listCredentials(deps: Deps, userId: string): Promise<CredentialMetadata[]> {
  const rows = await deps.db
    .prepare(`SELECT ${SAFE_COLUMNS} FROM provider_credentials WHERE owner_user_id = ? AND status = 'active' ORDER BY provider`)
    .bind(userId)
    .all<CredentialRow>()
  return rows.results.map(toMetadata)
}

/** Statements that revoke one credential and fence all unfinished work pinned to it. */
export function revokeCredentialStatements(deps: Deps, credentialId: string, now: number): D1PreparedStatement[] {
  const db = deps.db
  const pinned = `SELECT g.id FROM generations g
    JOIN run_credentials rc ON rc.run_id = g.run_id AND rc.provider = g.provider
    JOIN runs ru ON ru.id = g.run_id
    WHERE rc.credential_id = ? AND ru.status IN ('generating','ready')`
  return [
    // Queued work was provably never sent: release its reservations exactly once.
    ...releaseReservations(db, cond(`r.generation_id IN (${pinned} AND g.status = 'pending')`, credentialId), 'reserved', now),
    db
      .prepare(`UPDATE outbox SET status = 'terminal', last_error_code = 'CREDENTIAL_REVOKED', updated_at = ? WHERE status IN ('pending','dispatched') AND generation_id IN (${pinned})`)
      .bind(now, credentialId),
    db
      .prepare(`UPDATE generations SET status = 'failed', last_error_code = 'CREDENTIAL_REVOKED', updated_at = ? WHERE status = 'pending' AND id IN (${pinned})`)
      .bind(now, credentialId),
    // In-flight requests may still complete and be charged; their output will be rejected.
    db
      .prepare(`UPDATE generation_attempts SET status = 'uncertain', error_code = 'CREDENTIAL_REVOKED', finished_at = ? WHERE status = 'running' AND generation_id IN (${pinned})`)
      .bind(now, credentialId),
    db
      .prepare(`UPDATE generations SET status = 'uncertain', last_error_code = 'CREDENTIAL_REVOKED', updated_at = ? WHERE status = 'running' AND id IN (${pinned})`)
      .bind(now, credentialId),
    db
      .prepare(
        `UPDATE runs SET revision = revision + 1, updated_at = ?,
           status = CASE WHEN status = 'generating' AND NOT EXISTS (
             SELECT 1 FROM generations g WHERE g.run_id = runs.id AND g.status IN ('pending','running')) THEN 'ready' ELSE status END
         WHERE status IN ('generating','ready') AND id IN (SELECT run_id FROM run_credentials WHERE credential_id = ?)`,
      )
      .bind(now, credentialId),
    db
      .prepare(
        `UPDATE provider_credentials SET status = 'revoked', ciphertext = NULL, nonce = NULL, encryption_key_version = NULL,
           revoked_at = ?, revision = revision + 1 WHERE id = ? AND status = 'active'`,
      )
      .bind(now, credentialId),
  ]
}

export async function saveCredential(
  deps: Deps,
  userId: string,
  input: z.output<typeof createCredentialSchema>,
  idempotencyKey: string,
  ifMatch: number | null,
  requestId: string,
) {
  const { config } = deps
  if (!config.credentialWritesEnabled || !config.activeKeyVersion || !config.hmacKey) {
    throw new ApiError(503, 'CREDENTIAL_WRITES_DISABLED', 'Saving provider keys is temporarily unavailable.', { retryable: true })
  }
  const now = deps.now()
  const rate = await hitRateLimit(deps.db, `cred:${userId}`, 5, now)
  if (!rate.allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many key changes. Try again shortly.', { retryAfterSeconds: rate.retryAfterSeconds })

  const operation = input.replacesCredentialId ? 'credential.replace' : 'credential.create'
  // Keyed digest: the receipt can match a replay without ever holding the key.
  const digest = await hmacHex(
    config.hmacKey,
    canonicalJson({ operation, actor: userId, provider: input.provider, label: input.label, apiKey: input.apiKey, replaces: input.replacesCredentialId ?? null }),
  )
  const keyVersion = config.activeKeyVersion
  const rootKey = config.encryptionKeys.get(keyVersion)
  if (!rootKey) throw new ApiError(503, 'CREDENTIAL_WRITES_DISABLED', 'Saving provider keys is temporarily unavailable.')

  const result = await idempotent(deps, { actorUserId: userId, idempotencyKey, operation, requestHash: digest }, async (receipt) => {
    const credentialId = deps.newId()
    const sealed = await sealCredential(rootKey, { appId: config.appId, credentialId, ownerUserId: userId, provider: input.provider, keyVersion }, input.apiKey)
    const expiresAt = now + config.credentialTtlMs
    const metadata: CredentialMetadata = { id: credentialId, provider: input.provider, label: input.label, status: 'active', revision: 1, createdAt: now, expiresAt, lastUsedAt: null, lastUsedRunId: null, lastCheckedAt: null, lastCheckResult: null }
    const insert = deps.db
      .prepare(
        `INSERT INTO provider_credentials (id, owner_user_id, provider, label, ciphertext, nonce, encryption_key_version, status, revision, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
      )
      .bind(credentialId, userId, input.provider, input.label, sealed.ciphertext, sealed.nonce, keyVersion, now, expiresAt)
    const audit = auditStatement(deps.db, { eventType: operation, requestId, outcome: 'ok', actorUserId: userId, metadata: { provider: input.provider, credentialId } }, now)
    const response = { status: 201 as const, data: metadata }

    const replaces = input.replacesCredentialId
    if (!replaces) {
      try {
        await runGuarded(deps.db, operation, cond('1'), [insert, audit, receipt(response, credentialId)])
      } catch (error) {
        if (classifyConstraint(error) === 'active_credential') {
          throw new ApiError(409, 'STATE_CONFLICT', 'An active key for this provider already exists. Replace or remove it first.')
        }
        throw error
      }
      return response
    }

    if (ifMatch === null) throw new ApiError(428, 'REVISION_REQUIRED', 'Replacing a key requires the current key revision.')
    try {
      await runGuarded(
        deps.db,
        operation,
        all(cond(`EXISTS (SELECT 1 FROM provider_credentials WHERE id = ? AND owner_user_id = ? AND provider = ? AND status = 'active' AND revision = ?)`, replaces, userId, input.provider, ifMatch)),
        [...revokeCredentialStatements(deps, replaces, now), insert, audit, receipt(response, credentialId)],
      )
    } catch (error) {
      if (error instanceof GuardFailed) {
        const current = await deps.db
          .prepare(`SELECT ${SAFE_COLUMNS} FROM provider_credentials WHERE id = ? AND owner_user_id = ?`)
          .bind(replaces, userId)
          .first<CredentialRow>()
        if (!current || current.provider !== input.provider) throw notFound()
        throw revisionConflict()
      }
      throw error
    }
    return response
  })

  // Replay reauthorization: never report an obsolete active status for a key revoked since.
  if (result.replayed) {
    const stored = result.data as CredentialMetadata
    const current = await deps.db
      .prepare(`SELECT ${SAFE_COLUMNS} FROM provider_credentials WHERE id = ? AND owner_user_id = ?`)
      .bind(stored.id, userId)
      .first<CredentialRow>()
    if (!current) throw notFound()
    return { status: result.status, data: toMetadata(current) }
  }
  return result
}

/** Remove a credential. Always available, even when generation or decryption is broken. */
export async function removeCredential(deps: Deps, userId: string, credentialId: string, ifMatch: number | null, requestId: string): Promise<void> {
  const row = await deps.db
    .prepare(`SELECT ${SAFE_COLUMNS}, owner_user_id FROM provider_credentials WHERE id = ?`)
    .bind(credentialId)
    .first<CredentialRow>()
  if (!row || row.owner_user_id !== userId) throw notFound()
  if (row.status === 'revoked') return // repeated own deletion succeeds
  if (ifMatch === null) throw new ApiError(428, 'REVISION_REQUIRED', 'Removing a key requires its current revision.')
  const now = deps.now()
  try {
    await runGuarded(
      deps.db,
      'credential.revoke',
      cond(`EXISTS (SELECT 1 FROM provider_credentials WHERE id = ? AND owner_user_id = ? AND status = 'active' AND revision = ?)`, credentialId, userId, ifMatch),
      [
        ...revokeCredentialStatements(deps, credentialId, now),
        auditStatement(deps.db, { eventType: 'credential.revoke', requestId, outcome: 'ok', actorUserId: userId, metadata: { provider: row.provider, credentialId } }, now),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) {
      const current = await deps.db.prepare('SELECT status FROM provider_credentials WHERE id = ?').bind(credentialId).first<{ status: string }>()
      if (current?.status === 'revoked') return
      throw revisionConflict()
    }
    throw error
  }
}

/**
 * Extend an active, unexpired key's lifetime by the configured TTL. Does not
 * touch the ciphertext or any run that pins the key.
 */
export async function renewCredential(deps: Deps, userId: string, credentialId: string, ifMatch: number, requestId: string): Promise<CredentialMetadata> {
  const now = deps.now()
  const expiresAt = now + deps.config.credentialTtlMs
  try {
    await runGuarded(
      deps.db,
      'credential.renew',
      cond(
        `EXISTS (SELECT 1 FROM provider_credentials WHERE id = ? AND owner_user_id = ? AND status = 'active' AND revision = ? AND (expires_at IS NULL OR expires_at > ?))`,
        credentialId,
        userId,
        ifMatch,
        now,
      ),
      [
        deps.db.prepare('UPDATE provider_credentials SET expires_at = ?, revision = revision + 1 WHERE id = ?').bind(expiresAt, credentialId),
        auditStatement(deps.db, { eventType: 'credential.renew', requestId, outcome: 'ok', actorUserId: userId, metadata: { credentialId } }, now),
      ],
    )
  } catch (error) {
    if (error instanceof GuardFailed) {
      const current = await deps.db.prepare(`SELECT ${SAFE_COLUMNS}, owner_user_id FROM provider_credentials WHERE id = ?`).bind(credentialId).first<CredentialRow>()
      if (!current || current.owner_user_id !== userId) throw notFound()
      if (current.status !== 'active' || (current.expires_at !== null && current.expires_at <= now)) {
        throw new ApiError(409, 'STATE_CONFLICT', 'This key has expired or was removed. Save a new key instead.')
      }
      throw revisionConflict()
    }
    throw error
  }
  const row = await deps.db.prepare(`SELECT ${SAFE_COLUMNS} FROM provider_credentials WHERE id = ?`).bind(credentialId).first<CredentialRow>()
  if (!row) throw notFound()
  return toMetadata(row)
}

/**
 * Revoke every expired key through the normal revocation path (fences queued
 * and in-flight work, deletes ciphertext). Run by the maintenance cron.
 */
export async function expireCredentials(deps: Deps): Promise<number> {
  const now = deps.now()
  const expired = await deps.db
    .prepare(`SELECT id, owner_user_id, provider FROM provider_credentials WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ? LIMIT 50`)
    .bind(now)
    .all<{ id: string; owner_user_id: string; provider: ProviderId }>()
  let count = 0
  for (const row of expired.results) {
    try {
      await runGuarded(
        deps.db,
        'credential.expire',
        cond(`EXISTS (SELECT 1 FROM provider_credentials WHERE id = ? AND status = 'active' AND expires_at <= ?)`, row.id, now),
        [
          ...revokeCredentialStatements(deps, row.id, now),
          auditStatement(deps.db, { eventType: 'credential.expire', requestId: 'cron', outcome: 'revoked', actorUserId: row.owner_user_id, metadata: { provider: row.provider, credentialId: row.id } }, now),
        ],
      )
      count++
    } catch (error) {
      if (!(error instanceof GuardFailed)) throw error // renewed or removed meanwhile
    }
  }
  return count
}

export type CredentialFailure = 'CREDENTIAL_REVOKED' | 'CREDENTIAL_UNAVAILABLE' | 'CREDENTIAL_EXPIRED'

export class CredentialUnusable extends Error {
  constructor(readonly code: CredentialFailure) {
    super(code)
  }
}

/**
 * Resolve the run's pinned credential for `provider`, re-checking ownership and
 * active status immediately before decrypting, then hand the key to `send`.
 * Never falls back to another key or to platform billing.
 */
export async function withRunCredential<T>(
  deps: Deps,
  runId: string,
  provider: ProviderId,
  requestId: string,
  send: (apiKey: string) => Promise<T>,
): Promise<T> {
  const row = await deps.db
    .prepare(
      `SELECT c.id, c.owner_user_id, c.provider, c.status, c.ciphertext, c.nonce, c.encryption_key_version, c.expires_at
       FROM run_credentials rc JOIN provider_credentials c ON c.id = rc.credential_id
       JOIN runs r ON r.id = rc.run_id
       WHERE rc.run_id = ? AND rc.provider = ? AND c.owner_user_id = r.owner_user_id AND c.provider = rc.provider`,
    )
    .bind(runId, provider)
    .first<CredentialRow>()
  return decryptAndSend(deps, row, provider, runId, requestId, send)
}

/**
 * The special master's key (D-40): the judge's own saved key, pinned to the
 * grader run, with the same expiry, revocation, and decrypt checks as hearings.
 */
export async function withGraderCredential<T>(deps: Deps, graderRunId: string, provider: ProviderId, requestId: string, send: (apiKey: string) => Promise<T>): Promise<T> {
  const row = await deps.db
    .prepare(
      `SELECT c.id, c.owner_user_id, c.provider, c.status, c.ciphertext, c.nonce, c.encryption_key_version, c.expires_at, gr.run_id
       FROM grader_credentials gc JOIN provider_credentials c ON c.id = gc.credential_id
       JOIN grader_runs gr ON gr.id = gc.grader_run_id
       WHERE gc.grader_run_id = ? AND gc.provider = ? AND c.owner_user_id = gr.owner_user_id AND c.provider = gc.provider`,
    )
    .bind(graderRunId, provider)
    .first<CredentialRow & { run_id: string }>()
  return decryptAndSend(deps, row, provider, row?.run_id ?? graderRunId, requestId, send)
}

async function decryptAndSend<T>(deps: Deps, row: CredentialRow | null, provider: ProviderId, lastUsedRunId: string, requestId: string, send: (apiKey: string) => Promise<T>): Promise<T> {
  const runId = lastUsedRunId
  const apiKey = await openUsableKey(deps, row, provider, requestId)
  // Visible to the owner in Settings so unexpected use stands out. Metadata only.
  await deps.db
    .prepare(`UPDATE provider_credentials SET last_used_at = ?, last_used_run_id = ? WHERE id = ? AND status = 'active'`)
    .bind(deps.now(), runId, row!.id)
    .run()
  return send(apiKey)
}

/** Decrypt an active, unexpired key; the one place a stored key is opened. */
async function openUsableKey(deps: Deps, row: CredentialRow | null, provider: ProviderId, requestId: string): Promise<string> {
  if (!row) throw new CredentialUnusable('CREDENTIAL_UNAVAILABLE')
  if (row.status !== 'active' || !row.ciphertext || !row.nonce || !row.encryption_key_version) throw new CredentialUnusable('CREDENTIAL_REVOKED')
  // Expiry is enforced here too, so a key past its time is never decrypted even before the cron revokes it.
  if (row.expires_at !== null && row.expires_at <= deps.now()) throw new CredentialUnusable('CREDENTIAL_EXPIRED')
  const rootKey = deps.config.encryptionKeys.get(row.encryption_key_version)
  if (!rootKey) throw new CredentialUnusable('CREDENTIAL_UNAVAILABLE')
  try {
    return await openCredential(
      rootKey,
      { appId: deps.config.appId, credentialId: row.id, ownerUserId: row.owner_user_id, provider: row.provider, keyVersion: row.encryption_key_version },
      { ciphertext: row.ciphertext, nonce: row.nonce },
    )
  } catch (error) {
    if (error instanceof CredentialCryptoError) {
      await deps.db
        .prepare(`INSERT INTO audit_events (id, actor_user_id, event_type, request_id, outcome, metadata_json, created_at) VALUES (?, ?, 'credential.decrypt', ?, 'failed', ?, ?)`)
        .bind(deps.newId(), row.owner_user_id, requestId, JSON.stringify({ provider, credentialId: row.id }), deps.now())
        .run()
      throw new CredentialUnusable('CREDENTIAL_UNAVAILABLE')
    }
    throw error
  }
}

export interface KeyCheckView {
  result: KeyCheckResult
  reason: KeyCheckOutcome['reason']
  checkedAt: number
  credential: CredentialMetadata
}

/**
 * "Check key" (D-57): decrypt the owner's active key server-side and make the
 * provider's free list-models request with it. Records only the time and the
 * result. The key and any provider or transport text never leave this function.
 */
export async function checkCredential(deps: Deps, userId: string, credentialId: string, requestId: string): Promise<KeyCheckView> {
  const now = deps.now()
  const rate = await hitRateLimit(deps.db, `credcheck:${userId}`, 6, now)
  if (!rate.allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many key checks. Try again in a minute.', { retryAfterSeconds: rate.retryAfterSeconds })
  const row = await deps.db
    .prepare(`SELECT id, owner_user_id, provider, status, ciphertext, nonce, encryption_key_version, expires_at FROM provider_credentials WHERE id = ?`)
    .bind(credentialId)
    .first<CredentialRow>()
  if (!row || row.owner_user_id !== userId) throw notFound()
  let apiKey: string
  try {
    apiKey = await openUsableKey(deps, row, row.provider, requestId)
  } catch (error) {
    if (error instanceof CredentialUnusable) {
      const message = error.code === 'CREDENTIAL_UNAVAILABLE' ? 'This saved key could not be opened. Remove it and save it again.' : 'This key has expired or was removed. Save a new key instead.'
      throw new ApiError(409, 'STATE_CONFLICT', message)
    }
    throw error
  }
  const outcome = await checkProviderKey(deps.providerFetch, row.provider, apiKey)
  const checkedAt = deps.now()
  await deps.db.batch([
    deps.db.prepare(`UPDATE provider_credentials SET last_checked_at = ?, last_check_result = ? WHERE id = ? AND status = 'active'`).bind(checkedAt, outcome.result, row.id),
    auditStatement(deps.db, { eventType: 'credential.check', requestId, outcome: outcome.result, actorUserId: userId, metadata: { provider: row.provider, credentialId: row.id, reason: outcome.reason } }, checkedAt),
  ])
  deps.log({ event: 'credential.check', provider: row.provider, result: outcome.result, reason: outcome.reason, httpStatus: outcome.httpStatus, requestId })
  const current = await deps.db.prepare(`SELECT ${SAFE_COLUMNS} FROM provider_credentials WHERE id = ?`).bind(row.id).first<CredentialRow>()
  if (!current) throw notFound()
  return { result: outcome.result, reason: outcome.reason, checkedAt, credential: toMetadata(current) }
}

/**
 * Last check before a paid send: the claimed attempt must still hold its fence
 * and the run must still be generating on a live evaluation. Closes the window
 * where a cancel or delete lands between claim and send.
 */
export async function attemptStillCurrent(db: D1Database, attemptId: string, fence: string, runId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM generation_attempts a, runs r JOIN evaluations e ON e.id = r.evaluation_id
       WHERE a.id = ? AND a.fence_token = ? AND a.status = 'running' AND r.id = ? AND r.status = 'generating' AND e.deleted_at IS NULL`,
    )
    .bind(attemptId, fence, runId)
    .first()
  return row !== null
}
