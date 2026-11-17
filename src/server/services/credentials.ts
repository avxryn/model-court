/**
 * Personal provider credentials (F26–F28, spec §6.6, §9.6).
 *
 * Plaintext keys exist only inside `saveCredential` (to encrypt) and
 * `withRunCredential` (to authorize one provider request). They are never
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
import { idempotent } from '../receipts'

export interface CredentialMetadata {
  id: string
  provider: ProviderId
  label: string
  status: 'active' | 'revoked'
  revision: number
  createdAt: number
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
}

const SAFE_COLUMNS = 'id, provider, label, status, revision, created_at'

function toMetadata(row: Pick<CredentialRow, 'id' | 'provider' | 'label' | 'status' | 'revision' | 'created_at'>): CredentialMetadata {
  return { id: row.id, provider: row.provider, label: row.label, status: row.status, revision: row.revision, createdAt: row.created_at }
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
    const metadata: CredentialMetadata = { id: credentialId, provider: input.provider, label: input.label, status: 'active', revision: 1, createdAt: now }
    const insert = deps.db
      .prepare(
        `INSERT INTO provider_credentials (id, owner_user_id, provider, label, ciphertext, nonce, encryption_key_version, status, revision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)`,
      )
      .bind(credentialId, userId, input.provider, input.label, sealed.ciphertext, sealed.nonce, keyVersion, now)
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

export type CredentialFailure = 'CREDENTIAL_REVOKED' | 'CREDENTIAL_UNAVAILABLE'

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
      `SELECT c.id, c.owner_user_id, c.provider, c.status, c.ciphertext, c.nonce, c.encryption_key_version
       FROM run_credentials rc JOIN provider_credentials c ON c.id = rc.credential_id
       JOIN runs r ON r.id = rc.run_id
       WHERE rc.run_id = ? AND rc.provider = ? AND c.owner_user_id = r.owner_user_id AND c.provider = rc.provider`,
    )
    .bind(runId, provider)
    .first<CredentialRow>()
  if (!row) throw new CredentialUnusable('CREDENTIAL_UNAVAILABLE')
  if (row.status !== 'active' || !row.ciphertext || !row.nonce || !row.encryption_key_version) throw new CredentialUnusable('CREDENTIAL_REVOKED')
  const rootKey = deps.config.encryptionKeys.get(row.encryption_key_version)
  if (!rootKey) throw new CredentialUnusable('CREDENTIAL_UNAVAILABLE')
  let apiKey: string
  try {
    apiKey = await openCredential(
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
  return send(apiKey)
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
