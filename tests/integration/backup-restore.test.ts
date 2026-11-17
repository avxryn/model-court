/**
 * V9 backup and restore: redacted, consistent export; sealed files; restore
 * into a fresh store with every credential revoked and no ciphertext. Runs on
 * both stores (local D1 and the ModelCourtStore Durable Object).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_TABLES, BackupError, exportSnapshot, openSnapshot, restoreSnapshot, sealSnapshot, type StoreSnapshot } from '../../src/server/services/backup'
import { sha256Hex, canonicalJson } from '../../src/domain/canonical'
import { createHarness, OWNER, randomKeyB64, setupOwner, startRun, type Harness } from './harness'

let source: Harness
let target: Harness
beforeEach(async () => {
  source = await createHarness()
  target = await createHarness()
})
afterEach(async () => {
  await source.dispose()
  await target.dispose()
})

const backupKey = () => Uint8Array.from(Buffer.from(randomKeyB64(), 'base64'))

/** A store with a finished run, a second run still queued, and one removed key. */
async function populate(h: Harness) {
  const setup = await setupOwner(h)
  expect((await startRun(h, setup)).status).toBe(202)
  await h.drainJobs()
  const second = await h.request('POST', '/evaluations', { as: OWNER, body: { title: 'Queued work', taskDescription: 'Still generating at backup time' } })
  const queued = await startRun(h, { ...setup, evaluationId: second.json.data.id })
  expect(queued.status).toBe(202)
  const extra = await h.request('POST', '/credentials', { as: 'user_extra_4', body: { provider: 'openai', label: 'Removed later', apiKey: 'sk-test-SENTINEL-REMOVED-KEY', consentToStorage: true } })
  expect((await h.request('DELETE', `/credentials/${extra.json.data.id}`, { as: 'user_extra_4', ifMatch: 1 })).status).toBe(204)
  return { setup, queuedEvaluationId: second.json.data.id as string }
}

async function count(h: Harness, table: string): Promise<number> {
  return Number((await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0)
}

describe('export', () => {
  it('exports every table with credential secrets removed', async () => {
    await populate(source)
    const snapshot = await exportSnapshot(source.deps)
    const text = JSON.stringify(snapshot)
    expect(text).not.toContain('SENTINEL')
    expect(Object.keys(snapshot.tables)).toEqual([...BACKUP_TABLES])
    expect(snapshot.tables.provider_credentials).toHaveLength(3)
    for (const row of snapshot.tables.provider_credentials) {
      expect(row).toMatchObject({ status: 'revoked', ciphertext: null, nonce: null, encryption_key_version: null })
      expect(row.revoked_at).not.toBeNull()
    }
    expect(snapshot.redactions.credentialRowsRevoked).toBe(2)
    expect(snapshot.redactions.credentialReceiptsDropped).toBeGreaterThan(0)
    expect(snapshot.tables.command_receipts.some((row) => String(row.operation).startsWith('credential.'))).toBe(false)
    expect(snapshot.migrations).toContain('0002_credential_expiry_and_last_use')
    expect(snapshot.schema.some((object) => object.type === 'trigger' && object.name.startsWith('provider_credentials_status'))).toBe(true)
    // The live store is not changed by exporting.
    expect((await source.db.prepare(`SELECT COUNT(*) AS n FROM provider_credentials WHERE status = 'active'`).first<{ n: number }>())?.n).toBe(2)
  })

  it('refuses to export a table it does not know how to restore', async () => {
    await source.db.prepare('CREATE TABLE surprise_feature (id TEXT PRIMARY KEY)').run()
    await expect(exportSnapshot(source.deps)).rejects.toThrow('surprise_feature')
  })
})

describe('sealed backup files', () => {
  it('round-trips under the backup key and rejects tampering or the wrong key', async () => {
    await populate(source)
    const key = backupKey()
    const snapshot = await exportSnapshot(source.deps)
    const sealed = await sealSnapshot(key, snapshot)
    expect(JSON.stringify(sealed)).not.toContain('Support policy QA')
    expect(await openSnapshot(key, sealed)).toEqual(snapshot)

    await expect(openSnapshot(backupKey(), sealed)).rejects.toThrow(BackupError)
    const bytes = Buffer.from(sealed.ciphertext, 'base64')
    bytes[bytes.length - 1] ^= 0x01
    await expect(openSnapshot(key, { ...sealed, ciphertext: bytes.toString('base64') })).rejects.toThrow('wrong key, or the file was altered')
    await expect(openSnapshot(key, { ...sealed, exportedAt: sealed.exportedAt + 1 })).rejects.toThrow(BackupError)
    await expect(openSnapshot(key, { ...sealed, appId: 'app_other' })).rejects.toThrow(BackupError)
  })
})

describe('restore', () => {
  it('restores into a fresh store with every key revoked, no ciphertext, and no runnable work', async () => {
    const { queuedEvaluationId } = await populate(source)
    const snapshot = await openSnapshot(backupKey().fill(7), await sealSnapshot(backupKey().fill(7), await exportSnapshot(source.deps)))
    const report = await restoreSnapshot(target.deps, snapshot, { chunkSize: 3 })
    expect(report.credentialRowsRedacted).toBe(0)
    expect(report.unfinishedRunsFenced).toBe(1)

    // Every row arrives; the only addition is the store.restore audit event.
    for (const table of BACKUP_TABLES) expect(await count(target, table)).toBe(snapshot.tables[table].length + (table === 'audit_events' ? 1 : 0))
    const credentials = (await target.db.prepare('SELECT status, ciphertext, nonce, encryption_key_version FROM provider_credentials').all()).results
    expect(credentials.every((row) => row.status === 'revoked' && row.ciphertext === null && row.nonce === null && row.encryption_key_version === null)).toBe(true)

    // Owners keep their data, but have no usable key; the queued run can never call a provider.
    expect((await target.request('GET', '/credentials', { as: OWNER })).json.data.items).toEqual([])
    expect((await target.request('GET', `/evaluations/${queuedEvaluationId}`, { as: OWNER })).status).toBe(200)
    const generations = (await target.db.prepare(`SELECT g.status, g.last_error_code FROM generations g JOIN runs r ON r.id = g.run_id WHERE r.evaluation_id = ?`).bind(queuedEvaluationId).all()).results
    expect(generations.every((g) => g.status === 'failed' && g.last_error_code === 'CREDENTIAL_REVOKED')).toBe(true)
    target.jobs.push(...source.jobs)
    await target.drainJobs()
    expect(target.providerCalls).toHaveLength(0)

    // Revocation stays one-way in the restored store.
    await expect(target.db.prepare(`UPDATE provider_credentials SET status = 'active'`).run()).rejects.toThrow()
    const audit = await target.db.prepare(`SELECT outcome FROM audit_events WHERE event_type = 'store.restore'`).first<{ outcome: string }>()
    expect(audit?.outcome).toBe('ok')
  })

  it('revokes and strips credential rows even from a file that still carries ciphertext', async () => {
    await populate(source)
    const raw = (await source.db.prepare('SELECT * FROM provider_credentials').all()).results as StoreSnapshot['tables'][string]
    const receipts = (await source.db.prepare('SELECT * FROM command_receipts').all()).results as StoreSnapshot['tables'][string]
    const snapshot = await exportSnapshot(source.deps)
    const tables = { ...snapshot.tables, provider_credentials: raw, command_receipts: receipts }
    const unredacted = { ...snapshot, tables, contentDigest: await sha256Hex(canonicalJson(tables)) }
    expect(raw.some((row) => row.ciphertext !== null)).toBe(true)

    const report = await restoreSnapshot(target.deps, unredacted)
    expect(report.credentialRowsRedacted).toBe(2)
    expect(report.credentialReceiptsDropped).toBeGreaterThan(0)
    const restored = (await target.db.prepare('SELECT status, ciphertext, nonce FROM provider_credentials').all()).results
    expect(restored.every((row) => row.status === 'revoked' && row.ciphertext === null && row.nonce === null)).toBe(true)
    expect(await count(target, 'command_receipts')).toBe(receipts.filter((row) => !String(row.operation).startsWith('credential.')).length)
    const dump = JSON.stringify((await target.db.prepare('SELECT * FROM command_receipts').all()).results)
    expect(dump).not.toContain('credential.create')
  })

  it('refuses a non-empty target, another app, a corrupted file, unknown tables, and bad column names', async () => {
    await populate(source)
    const snapshot = await exportSnapshot(source.deps)

    await expect(restoreSnapshot(source.deps, snapshot)).rejects.toThrow('not empty')
    await expect(restoreSnapshot(target.deps, { ...snapshot, appId: 'app_other' })).rejects.toThrow('different app')
    await expect(restoreSnapshot(target.deps, { ...snapshot, format: 'other' as never })).rejects.toThrow(BackupError)

    const edited = structuredClone(snapshot)
    edited.tables.evaluations[0].title = 'Edited offline'
    await expect(restoreSnapshot(target.deps, edited)).rejects.toThrow('digest')

    const withUnknown = { ...snapshot, tables: { ...snapshot.tables, surprise: [] } }
    await expect(restoreSnapshot(target.deps, { ...withUnknown, contentDigest: await sha256Hex(canonicalJson(withUnknown.tables)) })).rejects.toThrow('Unknown table')

    const injected = structuredClone(snapshot)
    injected.tables.evaluations[0] = { ...injected.tables.evaluations[0], 'title) VALUES (1); --': 'x' }
    await expect(restoreSnapshot(target.deps, { ...injected, contentDigest: await sha256Hex(canonicalJson(injected.tables)) })).rejects.toThrow('Invalid column name')

    await expect(restoreSnapshot(target.deps, { ...snapshot, migrations: [...snapshot.migrations, '9999_future'] })).rejects.toThrow('lacks migrations')
    // Nothing was written by any refused attempt.
    for (const table of BACKUP_TABLES) expect(await count(target, table)).toBe(0)
  })
})
