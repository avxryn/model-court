/**
 * Store backup and restore (V9, docs/runbook.md "Backup and restore").
 *
 * - `exportSnapshot` reads every Model Court table in ONE store call (one
 *   `transactionSync` on the Durable Object, one D1 batch locally), so the
 *   snapshot is consistent. Credential secrets never leave the store: every
 *   `provider_credentials` row is exported revoked with no ciphertext, nonce,
 *   or root version, and receipts of credential commands (which hold a keyed
 *   digest of the submitted key) are dropped.
 * - `sealSnapshot` / `openSnapshot` wrap the snapshot in AES-256-GCM under a
 *   dedicated backup key, because it still holds user content (prompts,
 *   responses, ratings, verdicts). Never use a credential root as that key.
 * - `restoreSnapshot` loads a snapshot into an EMPTY, migrated store. It forces
 *   every credential row revoked without ciphertext again (even for a file that
 *   was not produced by `exportSnapshot`) and fences all work pinned to them,
 *   so nothing restored can ever spend money.
 *
 * Nothing here is reachable from an HTTP route. How the snapshot moves between
 * the live store and the operator is a platform step (see the runbook).
 */

import { recomputeStorageStatements } from './documents'
import { canonicalJson, sha256Hex } from '../../domain/canonical'
import { MIGRATIONS } from '../db/migrations'
import { auditStatement } from '../db/sql'
import type { Deps } from '../deps'
import { revokeCredentialStatements } from './credentials'

export const BACKUP_FORMAT = 'model-court-store-backup'
export const BACKUP_VERSION = 1

/**
 * Every data table, parents before children (restore insert order). A new
 * migration that adds a table MUST add it here; export refuses unknown tables
 * so a backup can never silently miss data.
 */
export const BACKUP_TABLES = [
  'evaluations',
  // Spec 04 (D-87): documents. Blobs before their chunks and references; buckets are recomputed on restore.
  'document_blobs',
  'document_blob_chunks',
  'evaluation_documents',
  'document_storage_buckets',
  'evaluation_imports',
  'runs',
  'run_documents',
  'run_imported_outputs',
  'grader_runs',
  'grader_credentials',
  'grader_items',
  'grader_attempts',
  'grader_outbox',
  'grader_reservations',
  'generations',
  'generation_attempts',
  // D-76: automatic check results (no secrets); after their parents.
  'testimony_checks',
  'review_sessions',
  'invites',
  'verdict_revisions',
  'command_receipts',
  'outbox',
  'budget_buckets',
  'attempt_reservations',
  'rate_buckets',
  'provider_credentials',
  'run_credentials',
  'audit_events',
] as const

/**
 * Tables that are never exported: the transient guard sentinel, the migration ledger (sent separately), and
 * guest-juror access (D-41): a restore must never bring back a working guest cookie or resume link.
 */
const NOT_EXPORTED = new Set(['command_guards', 'mc_schema_migrations', 'juror_principals', 'juror_devices'])
/** Platform/engine tables that are not Model Court data (SQLite, Cloudflare `_cf_*`, D1, Miniflare `__miniflare_*`). */
const PLATFORM_TABLE = /^(sqlite_|_cf_|d1_|__)/

type Value = string | number | null
type Row = Record<string, Value>

export interface StoreSnapshot {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  appId: string
  exportedAt: number
  /** Applied migration ids at export time. */
  migrations: string[]
  /** Schema objects (tables, indexes, triggers) for reference and audit; restore relies on the target's own migrations. */
  schema: Array<{ type: string; name: string; sql: string }>
  tables: Record<string, Row[]>
  /** `pdfChunksOmitted` (spec 04 §4.6, decision 4): PDF bytes never leave the store in a backup; absent in older files. */
  redactions: { credentialRowsRevoked: number; credentialReceiptsDropped: number; pdfChunksOmitted?: number }
  /** sha256 of canonicalJson(tables): detects corruption of an unsealed file. */
  contentDigest: string
}

export class BackupError extends Error {}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** The credential row as it may exist outside the store: revoked, no secret material. */
function redactCredential(row: Row, at: number): Row {
  return { ...row, status: 'revoked', ciphertext: null, nonce: null, encryption_key_version: null, revoked_at: row.revoked_at ?? at }
}

const isCredentialReceipt = (row: Row) => typeof row.operation === 'string' && row.operation.startsWith('credential.')

/** The id of the migration whose statements create `table` (by name, or as `<table>_next` renamed). */
export function creatingMigration(table: string): string | null {
  const creates = (sql: string) => new RegExp(`^\\s*CREATE TABLE (IF NOT EXISTS )?${table}(_next)?\\s*\\(`, 'i').test(sql)
  return MIGRATIONS.find((migration) => migration.statements.some(creates))?.id ?? null
}

export async function exportSnapshot(deps: Deps): Promise<StoreSnapshot> {
  const db = deps.db
  const exportedAt = deps.now()
  // A store whose schema predates a table this build knows (held at an older migration) has nothing
  // in it: that table exports as empty instead of failing the whole read. A table missing although
  // the migration that creates it is recorded means a damaged store, and the export refuses (D-80).
  const present = new Set((await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all<{ name: string }>()).results.map((row) => row.name))
  const exported = BACKUP_TABLES.filter((table) => present.has(table))
  const [schemaResult, ledgerResult, ...readResults] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name`),
    db.prepare('SELECT id FROM mc_schema_migrations ORDER BY id'),
    ...exported.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`)),
  ])
  const applied = new Set((ledgerResult.results as Array<{ id: string }>).map((row) => row.id))
  const damaged = BACKUP_TABLES.filter((table) => !present.has(table) && applied.has(creatingMigration(table) ?? ''))
  if (damaged.length > 0) throw new BackupError(`Tables missing although their migration is recorded: ${damaged.join(', ')}. The store looks damaged; nothing was exported.`)
  const tableResults = BACKUP_TABLES.map((table) => (present.has(table) ? readResults[exported.indexOf(table)] : { results: [] }))
  const schema = (schemaResult.results as Array<{ type: string; name: string; sql: string; tbl_name?: string }>)
    .filter((object) => !PLATFORM_TABLE.test(object.name))
    .map(({ type, name, sql }) => ({ type, name, sql }))
  const unknown = schema.filter((object) => object.type === 'table' && !NOT_EXPORTED.has(object.name) && !(BACKUP_TABLES as readonly string[]).includes(object.name))
  if (unknown.length > 0) throw new BackupError(`Tables without a backup order: ${unknown.map((object) => object.name).join(', ')}. Add them to BACKUP_TABLES.`)

  const tables: Record<string, Row[]> = {}
  const redactions = { credentialRowsRevoked: 0, credentialReceiptsDropped: 0, pdfChunksOmitted: 0 }
  const pdfBlobs = new Set((tableResults[BACKUP_TABLES.indexOf('document_blobs')].results as Row[]).filter((row) => row.media_type === 'application/pdf').map((row) => row.id))
  BACKUP_TABLES.forEach((table, index) => {
    let rows = tableResults[index].results as Row[]
    if (table === 'document_blob_chunks') {
      // Decision 4: text documents travel whole; PDF chunks are left out (their blob rows and hashes stay).
      const kept = rows.filter((row) => !pdfBlobs.has(row.blob_id))
      redactions.pdfChunksOmitted = rows.length - kept.length
      rows = kept
    }
    if (table === 'provider_credentials') {
      redactions.credentialRowsRevoked = rows.filter((row) => row.status === 'active').length
      rows = rows.map((row) => redactCredential(row, exportedAt))
    }
    if (table === 'command_receipts') {
      const kept = rows.filter((row) => !isCredentialReceipt(row))
      redactions.credentialReceiptsDropped = rows.length - kept.length
      rows = kept
    }
    tables[table] = rows
  })

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appId: deps.config.appId,
    exportedAt,
    migrations: (ledgerResult.results as Array<{ id: string }>).map((row) => row.id),
    schema,
    tables,
    redactions,
    contentDigest: await sha256Hex(canonicalJson(tables)),
  }
}

export interface RestoreReport {
  rows: Record<string, number>
  /** Credential rows that arrived active or with secret material and were revoked/stripped on the way in. */
  credentialRowsRedacted: number
  credentialReceiptsDropped: number
  /** Runs that had queued or in-flight generations, now fenced with CREDENTIAL_REVOKED. */
  unfinishedRunsFenced: number
}

/**
 * Load a snapshot into an empty store whose migrations include every migration
 * the snapshot was taken at. Not one transaction across tables: on failure,
 * discard the target store and restore again into a fresh one.
 */
export async function restoreSnapshot(deps: Deps, snapshot: StoreSnapshot, options: { chunkSize?: number } = {}): Promise<RestoreReport> {
  const db = deps.db
  if (snapshot?.format !== BACKUP_FORMAT || snapshot.version !== BACKUP_VERSION) throw new BackupError('Not a Model Court store backup of a supported version.')
  if (snapshot.appId !== deps.config.appId) throw new BackupError('The backup belongs to a different app.')
  if (snapshot.contentDigest !== (await sha256Hex(canonicalJson(snapshot.tables)))) throw new BackupError('Backup content does not match its digest.')
  for (const table of Object.keys(snapshot.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(table)) throw new BackupError(`Unknown table in backup: ${table}.`)
  }

  await deps.ensureSchema()
  const applied = new Set((await db.prepare('SELECT id FROM mc_schema_migrations').all<{ id: string }>()).results.map((row) => row.id))
  const missing = snapshot.migrations.filter((id) => !applied.has(id))
  if (missing.length > 0) throw new BackupError(`The target store lacks migrations: ${missing.join(', ')}.`)

  // Guest-juror tables (D-41) are never restored, so they must be empty too, or old cookies could match restored sessions.
  const counts = await db.batch<{ n: number }>([...BACKUP_TABLES, 'juror_principals', 'juror_devices'].map((table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`)))
  if (counts.some((result) => Number(result.results[0]?.n ?? 0) > 0)) throw new BackupError('The target store is not empty. Restore only into a fresh store.')

  const now = deps.now()
  const chunkSize = Math.max(1, Math.min(options.chunkSize ?? 50, 200))
  const report: RestoreReport = { rows: {}, credentialRowsRedacted: 0, credentialReceiptsDropped: 0, unfinishedRunsFenced: 0 }
  for (const table of BACKUP_TABLES) {
    let rows = snapshot.tables[table] ?? []
    if (table === 'provider_credentials') {
      // Defense in depth: whatever the file says, no restored key is usable.
      report.credentialRowsRedacted = rows.filter((row) => row.status !== 'revoked' || row.ciphertext !== null || row.nonce !== null).length
      rows = rows.map((row) => redactCredential(row, now))
    }
    if (table === 'command_receipts') {
      const kept = rows.filter((row) => !isCredentialReceipt(row))
      report.credentialReceiptsDropped = rows.length - kept.length
      rows = kept
    }
    // Spec 04 §4.6: byte counters are recomputed below from what was restored, never trusted from the file.
    if (table === 'document_storage_buckets') rows = []
    const statements = rows.map((row) => {
      const columns = Object.keys(row)
      if (columns.length === 0 || !columns.every((column) => IDENTIFIER.test(column))) throw new BackupError(`Invalid column name in ${table}.`)
      return db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...columns.map((column) => row[column]))
    })
    for (let start = 0; start < statements.length; start += chunkSize) await db.batch(statements.slice(start, start + chunkSize))
    report.rows[table] = rows.length
  }

  await db.batch(recomputeStorageStatements(db, deps.config.documentStorage))

  // Fence all unfinished work pinned to any restored key (the final UPDATE is a no-op: rows are already revoked).
  report.unfinishedRunsFenced = Number((await db.prepare(`SELECT COUNT(DISTINCT run_id) AS n FROM generations WHERE status IN ('pending','running')`).first<{ n: number }>())?.n ?? 0)
  const pinned = await db.prepare('SELECT DISTINCT credential_id AS id FROM run_credentials').all<{ id: string }>()
  for (const row of pinned.results) await db.batch(revokeCredentialStatements(deps, row.id, now))

  await auditStatement(db, { eventType: 'store.restore', requestId: 'operator', outcome: 'ok', metadata: { exportedAt: snapshot.exportedAt, credentialRowsRedacted: report.credentialRowsRedacted, rows: Object.values(report.rows).reduce((a, b) => a + b, 0) } }, now).run()
  return report
}

// ---------------------------------------------------------------------------
// Sealed (encrypted) backup files.
// ---------------------------------------------------------------------------

export interface SealedBackup {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  appId: string
  exportedAt: number
  alg: 'AES-256-GCM'
  nonce: string
  ciphertext: string
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

const headerAad = (header: Omit<SealedBackup, 'nonce' | 'ciphertext'>) =>
  new TextEncoder().encode(canonicalJson({ alg: header.alg, appId: header.appId, exportedAt: header.exportedAt, format: header.format, version: header.version }))

async function backupKey(rawKey: Uint8Array<ArrayBuffer>, usage: KeyUsage): Promise<CryptoKey> {
  if (rawKey.byteLength !== 32) throw new BackupError('The backup key must be 32 bytes.')
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [usage])
}

export async function sealSnapshot(rawKey: Uint8Array<ArrayBuffer>, snapshot: StoreSnapshot): Promise<SealedBackup> {
  const header = { format: BACKUP_FORMAT, version: BACKUP_VERSION, appId: snapshot.appId, exportedAt: snapshot.exportedAt, alg: 'AES-256-GCM' } as const
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: headerAad(header), tagLength: 128 },
    await backupKey(rawKey, 'encrypt'),
    new TextEncoder().encode(JSON.stringify(snapshot)),
  )
  return { ...header, nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(ciphertext)) }
}

export async function openSnapshot(rawKey: Uint8Array<ArrayBuffer>, sealed: SealedBackup): Promise<StoreSnapshot> {
  let snapshot: StoreSnapshot
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.nonce), additionalData: headerAad(sealed), tagLength: 128 },
      await backupKey(rawKey, 'decrypt'),
      fromBase64(sealed.ciphertext),
    )
    snapshot = JSON.parse(new TextDecoder().decode(plaintext)) as StoreSnapshot
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('Backup could not be decrypted: wrong key, or the file was altered.')
  }
  if (snapshot.appId !== sealed.appId || snapshot.exportedAt !== sealed.exportedAt) throw new BackupError('Backup header does not match its content.')
  return snapshot
}
