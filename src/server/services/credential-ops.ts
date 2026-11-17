/**
 * Operator credential maintenance (docs/runbook.md "Root-key rotation" and
 * "Backup and restore"). Driven only by the maintenance cron and Worker
 * `[vars]`; no HTTP route reaches this module.
 *
 * - Re-keying decrypts each active key under its recorded root and seals it
 *   again under the target root with a fresh nonce and the same canonical AAD
 *   (now naming the target version). Stateless and resumable: every tick
 *   selects the active rows not yet on the target, so a crash, a timeout, or a
 *   second concurrent tick only repeats harmless work.
 * - Post-restore revocation revokes every active key created before a cutoff,
 *   through the normal revocation path.
 *
 * Plaintext exists only in local variables between open and seal. It is never
 * logged, returned, stored, or put in an error message. Revoked rows are never
 * selected, so they stay exactly as they were.
 */

import type { ProviderId } from '../../domain/registry'
import { CredentialCryptoError, openCredential, sealCredential, type CredentialBinding } from '../credential-crypto'
import { auditStatement, cond, GuardFailed, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { revokeCredentialStatements } from './credentials'

interface ActiveRow {
  id: string
  owner_user_id: string
  provider: ProviderId
  ciphertext: string
  nonce: string
  encryption_key_version: string
}

export interface RekeyReport {
  targetVersion: string
  /** Re-encrypted and verified under the target root in this pass. */
  rekeyed: number
  /** Failed authentication under their recorded root (tampered, or the wrong root is configured). Left untouched. */
  unreadable: number
  /** Unreadable keys revoked in this pass (only with CREDENTIAL_REKEY_REVOKE_UNREADABLE). */
  revokedUnreadable: number
  /** Recorded root version is not configured in this Worker. Left untouched. */
  rootMissing: number
  /** Changed, revoked, or re-keyed by someone else between read and write. */
  skipped: number
  /** Active keys still not on the target version after this pass (includes unreadable and root-missing rows). */
  remaining: number
  /** Opaque ids of the unreadable rows, for the operator's follow-up. Never key material. */
  unreadableCredentialIds: string[]
}

export interface RekeyOptions {
  targetVersion: string
  revokeUnreadable?: boolean
  /** Rows read per query. */
  batchSize?: number
  /** Upper bound on rows examined per call, so one cron tick stays short. */
  maxRows?: number
}

const sameSealedRow = (row: ActiveRow) =>
  cond(
    `EXISTS (SELECT 1 FROM provider_credentials WHERE id = ? AND status = 'active' AND encryption_key_version = ? AND nonce = ? AND ciphertext = ?)`,
    row.id,
    row.encryption_key_version,
    row.nonce,
    row.ciphertext,
  )

export async function rekeyCredentials(deps: Deps, options: RekeyOptions): Promise<RekeyReport> {
  const { config, db } = deps
  const target = options.targetVersion
  const targetRoot = config.encryptionKeys.get(target)
  if (!targetRoot) throw new Error(`Re-key target root ${target} is not configured.`)
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 25, 100))
  const maxRows = Math.max(1, options.maxRows ?? 250)
  const report: RekeyReport = { targetVersion: target, rekeyed: 0, unreadable: 0, revokedUnreadable: 0, rootMissing: 0, skipped: 0, remaining: 0, unreadableCredentialIds: [] }
  const binding = (row: ActiveRow, keyVersion: string): CredentialBinding => ({
    appId: config.appId,
    credentialId: row.id,
    ownerUserId: row.owner_user_id,
    provider: row.provider,
    keyVersion,
  })

  // Keyset pagination by id: rows that cannot be re-keyed are passed over, never retried within one call.
  let cursor = ''
  let examined = 0
  while (examined < maxRows) {
    const page = await db
      .prepare(
        `SELECT id, owner_user_id, provider, ciphertext, nonce, encryption_key_version FROM provider_credentials
         WHERE status = 'active' AND encryption_key_version <> ? AND id > ? ORDER BY id LIMIT ?`,
      )
      .bind(target, cursor, Math.min(batchSize, maxRows - examined))
      .all<ActiveRow>()
    for (const row of page.results) {
      examined++
      cursor = row.id
      const fromRoot = config.encryptionKeys.get(row.encryption_key_version)
      if (!fromRoot) {
        report.rootMissing++
        continue
      }
      const now = deps.now()
      let plaintext: string
      try {
        plaintext = await openCredential(fromRoot, binding(row, row.encryption_key_version), { ciphertext: row.ciphertext, nonce: row.nonce })
      } catch (error) {
        if (!(error instanceof CredentialCryptoError)) throw error
        report.unreadable++
        report.unreadableCredentialIds.push(row.id)
        if (options.revokeUnreadable) {
          try {
            await runGuarded(db, 'credential.rekey.revoke', sameSealedRow(row), [
              ...revokeCredentialStatements(deps, row.id, now),
              auditStatement(db, { eventType: 'credential.rekey', requestId: 'cron', outcome: 'revoked', actorUserId: row.owner_user_id, metadata: { credentialId: row.id, provider: row.provider, from: row.encryption_key_version, to: target } }, now),
            ])
            report.revokedUnreadable++
          } catch (revokeError) {
            if (!(revokeError instanceof GuardFailed)) throw revokeError
            report.skipped++
          }
        }
        continue
      }
      const sealed = await sealCredential(targetRoot, binding(row, target), plaintext)
      // Prove the new ciphertext opens before the old one is replaced; a failure here aborts the pass.
      if ((await openCredential(targetRoot, binding(row, target), sealed)) !== plaintext) throw new Error('Re-key verification failed.')
      try {
        // Same row, same revision, same expiry: re-keying is invisible to the owner and to If-Match.
        await runGuarded(db, 'credential.rekey', sameSealedRow(row), [
          db
            .prepare(`UPDATE provider_credentials SET ciphertext = ?, nonce = ?, encryption_key_version = ? WHERE id = ? AND status = 'active' AND nonce = ?`)
            .bind(sealed.ciphertext, sealed.nonce, target, row.id, row.nonce),
          auditStatement(db, { eventType: 'credential.rekey', requestId: 'cron', outcome: 'ok', actorUserId: row.owner_user_id, metadata: { credentialId: row.id, provider: row.provider, from: row.encryption_key_version, to: target } }, now),
        ])
        report.rekeyed++
      } catch (error) {
        if (!(error instanceof GuardFailed)) throw error
        report.skipped++
      }
    }
    if (page.results.length === 0 || page.results.length < batchSize) break
  }

  const remaining = await db
    .prepare(`SELECT COUNT(*) AS n FROM provider_credentials WHERE status = 'active' AND encryption_key_version <> ?`)
    .bind(target)
    .first<{ n: number }>()
  report.remaining = Number(remaining?.n ?? 0)
  return report
}

/**
 * Revoke every active key created before `cutoff` (epoch ms), fencing the work
 * pinned to it. Used after a store restore so no key from before the restore
 * point can be used again. Idempotent: keys created after the cutoff are untouched.
 */
export async function revokeCredentialsCreatedBefore(deps: Deps, cutoff: number, maxRows = 250): Promise<{ revoked: number; remaining: number }> {
  const db = deps.db
  let revoked = 0
  let examined = 0
  while (examined < maxRows) {
    const page = await db
      .prepare(`SELECT id, owner_user_id, provider FROM provider_credentials WHERE status = 'active' AND created_at < ? ORDER BY id LIMIT ?`)
      .bind(cutoff, Math.min(50, maxRows - examined))
      .all<{ id: string; owner_user_id: string; provider: ProviderId }>()
    if (page.results.length === 0) break
    for (const row of page.results) {
      examined++
      const now = deps.now()
      try {
        await runGuarded(db, 'credential.restore_revoke', cond(`EXISTS (SELECT 1 FROM provider_credentials WHERE id = ? AND status = 'active' AND created_at < ?)`, row.id, cutoff), [
          ...revokeCredentialStatements(deps, row.id, now),
          auditStatement(db, { eventType: 'credential.restore_revoke', requestId: 'cron', outcome: 'revoked', actorUserId: row.owner_user_id, metadata: { credentialId: row.id, provider: row.provider } }, now),
        ])
        revoked++
      } catch (error) {
        if (!(error instanceof GuardFailed)) throw error
      }
    }
  }
  const remaining = await db.prepare(`SELECT COUNT(*) AS n FROM provider_credentials WHERE status = 'active' AND created_at < ?`).bind(cutoff).first<{ n: number }>()
  return { revoked, remaining: Number(remaining?.n ?? 0) }
}

/** Cron entry point: runs whichever operator operation `[vars]` enables, logging counts only. */
export async function runCredentialOps(deps: Deps): Promise<void> {
  const ops = deps.config.credentialOps
  if (ops.revokeCreatedBefore !== null) {
    const result = await revokeCredentialsCreatedBefore(deps, ops.revokeCreatedBefore)
    deps.log({ event: 'credential.restore_revoke', cutoff: ops.revokeCreatedBefore, ...result })
  }
  if (ops.rekeyTargetVersion !== null) {
    const { unreadableCredentialIds, ...counts } = await rekeyCredentials(deps, { targetVersion: ops.rekeyTargetVersion, revokeUnreadable: ops.rekeyRevokeUnreadable })
    deps.log({ event: 'credential.rekey', ...counts, unreadableIds: unreadableCredentialIds.slice(0, 20).join(',') || null })
  }
}
