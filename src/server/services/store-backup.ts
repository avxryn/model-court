/**
 * The live backup path (V9, D-117). A daily cron task, and an on-demand one the operator asks for with
 * `BACKUP_REQUESTED_AT`, export the store (`exportSnapshot`: one consistent read, credentials revoked
 * without ciphertext, PDFs left out), seal it to the operator's public key (`backup-seal.ts`) and upload
 * it to the app owner's private files folder. Only the newest `BACKUP_KEEP` files are kept. The owner
 * downloads one with `npx deepspace app files get --private <key>` and opens it offline with
 * `npm run backup -- open` (docs/runbook.md). There is no HTTP route that exports or restores.
 */

import type { Deps } from '../deps'
import { exportSnapshot } from './backup'
import { sealSnapshotTo } from './backup-seal'

/** Where backups live in the owner's private folder. */
export const BACKUP_PREFIX = 'model-court-backups/'
/** One upload request carries at most this much (the platform's single-request limit is 25 MiB). */
export const MAX_BACKUP_UPLOAD_BYTES = 24 * 1024 * 1024

/** The owner's private files, narrowed to what a backup needs. Platform: `appFiles(env, { scope: 'self' })`. */
export interface BackupFiles {
  /** Stores `body` at `key` (relative to the private folder). */
  upload(key: string, body: string): Promise<void>
  /** Files under `prefix`: `key` relative to the folder, `ref` what `remove` takes. */
  list(prefix: string): Promise<Array<{ key: string; ref: string }>>
  remove(ref: string): Promise<void>
}

/** `model-court-backups/2026-11-19T21-04-05-123Z.json`: sorts by time, and the time can be read back. */
export function backupFileKey(exportedAt: number): string {
  return `${BACKUP_PREFIX}${new Date(exportedAt).toISOString().replace(/[:.]/g, '-')}.json`
}

/** The export time a backup key names, or null for any other file. */
export function exportedAtOfKey(key: string): number | null {
  const match = /^model-court-backups\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/.exec(key)
  if (!match) return null
  const at = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`)
  return Number.isFinite(at) ? at : null
}

/** The backup keys to delete so that only the newest `keep` remain; other files are never touched. */
export function backupsToPrune(keys: readonly string[], keep: number): string[] {
  const dated = keys.map((key) => ({ key, at: exportedAtOfKey(key) })).filter((entry): entry is { key: string; at: number } => entry.at !== null)
  return dated
    .sort((a, b) => b.at - a.at)
    .slice(Math.max(1, keep))
    .map((entry) => entry.key)
}

export type BackupReason = 'scheduled' | 'requested'

export type BackupResult =
  | { status: 'off'; reason: 'no_public_key' | 'no_files' }
  | { status: 'skipped'; reason: 'already_satisfied' }
  | { status: 'written'; key: string; bytes: number; pruned: number }
  | { status: 'failed'; reason: 'too_large' | 'export' | 'seal' | 'upload' | 'list' }

/** Ends a request the operator made with `BACKUP_REQUESTED_AT`; one per isolate, so the cron stops listing. */
let satisfiedRequest: number | null = null

/** Test hook: forget the in-isolate memory of a satisfied request. */
export function resetBackupMemory() {
  satisfiedRequest = null
}

/**
 * Writes one sealed backup. A `requested` run first checks whether a backup at or after the requested
 * time already exists, so setting the variable takes one backup, not one per minute.
 */
export async function runBackup(deps: Deps, files: BackupFiles | undefined, reason: BackupReason): Promise<BackupResult> {
  const config = deps.config.backup
  if (!config.publicKey) return { status: 'off', reason: 'no_public_key' }
  if (!files) return { status: 'off', reason: 'no_files' }
  const fail = (failure: Extract<BackupResult, { status: 'failed' }>['reason'], error?: unknown): BackupResult => {
    deps.log({ event: 'backup.failed', reason: failure, trigger: reason, error: error instanceof Error ? error.name : null })
    return { status: 'failed', reason: failure }
  }

  let existing: Array<{ key: string; ref: string }>
  try {
    existing = await files.list(BACKUP_PREFIX)
  } catch (error) {
    return fail('list', error)
  }
  if (reason === 'requested') {
    const requestedAt = config.requestedAt
    if (requestedAt === null || satisfiedRequest === requestedAt) return { status: 'skipped', reason: 'already_satisfied' }
    if (existing.some((file) => (exportedAtOfKey(file.key) ?? 0) >= requestedAt)) {
      satisfiedRequest = requestedAt
      return { status: 'skipped', reason: 'already_satisfied' }
    }
  }

  let snapshot: Awaited<ReturnType<typeof exportSnapshot>>
  try {
    snapshot = await exportSnapshot(deps)
  } catch (error) {
    return fail('export', error)
  }
  let body: string
  try {
    body = JSON.stringify(await sealSnapshotTo(config.publicKey, snapshot))
  } catch (error) {
    return fail('seal', error)
  }
  const bytes = new TextEncoder().encode(body).byteLength
  if (bytes > MAX_BACKUP_UPLOAD_BYTES) return fail('too_large')
  const key = backupFileKey(snapshot.exportedAt)
  try {
    await files.upload(key, body)
  } catch (error) {
    return fail('upload', error)
  }
  if (reason === 'requested' && config.requestedAt !== null) satisfiedRequest = config.requestedAt

  // Pruning never fails the backup that was just written.
  let pruned = 0
  const refs = new Map(existing.map((file) => [file.key, file.ref]))
  for (const old of backupsToPrune([...existing.map((file) => file.key).filter((name) => name !== key), key], config.keep)) {
    const ref = refs.get(old)
    if (ref === undefined) continue
    try {
      await files.remove(ref)
      pruned++
    } catch (error) {
      deps.log({ event: 'backup.prune_failed', error: error instanceof Error ? error.name : null })
    }
  }
  const rows = Object.values(snapshot.tables).reduce((total, list) => total + list.length, 0)
  deps.log({ event: 'backup.written', trigger: reason, key, bytes, rows, migrations: snapshot.migrations.length, pruned })
  return { status: 'written', key, bytes, pruned }
}
