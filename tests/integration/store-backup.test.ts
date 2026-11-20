/**
 * V9 live backup path (D-117): the cron's sealed backups to the owner's private files, on both
 * stores. The files client is an in-memory fake; the platform's appFiles is not exercised here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateOperatorKeyPair, openSnapshotWith, type OperatorSealedBackup } from '../../src/server/services/backup-seal'
import { restoreSnapshot } from '../../src/server/services/backup'
import { BACKUP_PREFIX, backupFileKey, resetBackupMemory, runBackup, type BackupFiles } from '../../src/server/services/store-backup'
import { createHarness, OWNER, setupOwner, startRun, type Harness } from './harness'

let source: Harness
let target: Harness | null = null
let pair: Awaited<ReturnType<typeof generateOperatorKeyPair>>

/** An in-memory private folder that records every call. */
function fakeFiles(options: { failUpload?: boolean } = {}) {
  const stored = new Map<string, string>()
  const calls: string[] = []
  const files: BackupFiles = {
    upload: async (key, body) => {
      calls.push(`upload ${key}`)
      if (options.failUpload) throw new Error('quota')
      stored.set(key, body)
    },
    list: async (prefix) => {
      calls.push(`list ${prefix}`)
      return [...stored.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, ref: `stored/${key}` }))
    },
    remove: async (ref) => {
      calls.push(`remove ${ref}`)
      stored.delete(ref.replace(/^stored\//, ''))
    },
  }
  return { files, stored, calls }
}

async function harness(env: Record<string, string> = {}) {
  return createHarness({ env: { BACKUP_PUBLIC_KEY: pair.publicSpki, ...env } })
}

beforeEach(async () => {
  resetBackupMemory()
  pair = await generateOperatorKeyPair()
  source = await harness()
})
afterEach(async () => {
  await source.dispose()
  await target?.dispose()
  target = null
})

async function populate(h: Harness) {
  const setup = await setupOwner(h)
  expect((await startRun(h, setup)).status).toBe(202)
  await h.drainJobs()
  return setup
}

describe('sealed backups to the owner’s private files', () => {
  it('writes one sealed file that only the operator key opens, and that restores into an empty store', async () => {
    const setup = await populate(source)
    const { files, stored } = fakeFiles()
    const result = await runBackup(source.deps, files, 'scheduled')
    expect(result).toMatchObject({ status: 'written', key: backupFileKey(source.deps.now()), pruned: 0 })
    expect([...stored.keys()]).toEqual([backupFileKey(source.deps.now())])
    const body = [...stored.values()][0]
    // Sealed: no prompt, no key material, no title in the uploaded bytes.
    expect(body).not.toContain('SENTINEL')
    expect(body).not.toContain(setup.draft.cases[0].input)
    const sealed = JSON.parse(body) as OperatorSealedBackup
    expect(sealed).toMatchObject({ version: 2, recipient: pair.recipient })
    const snapshot = await openSnapshotWith(pair.privatePkcs8, sealed)
    expect(snapshot.tables.runs).toHaveLength(1)
    expect(snapshot.tables.provider_credentials.every((row) => row.ciphertext === null && row.status === 'revoked')).toBe(true)

    target = await harness()
    await restoreSnapshot(target.deps, snapshot)
    for (const table of ['evaluations', 'runs', 'generations', 'generation_attempts']) {
      const n = await target.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()
      expect(Number(n?.n), table).toBe(snapshot.tables[table].length)
    }
    const owner = await target.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })
    expect(owner.status).toBe(200)
  })

  it('keeps only the newest BACKUP_KEEP files and leaves other files alone', async () => {
    await source.dispose()
    source = await harness({ BACKUP_KEEP: '2' })
    const { files, stored, calls } = fakeFiles()
    stored.set(`${BACKUP_PREFIX}readme.txt`, 'operator notes')
    for (let day = 0; day < 4; day++) {
      expect((await runBackup(source.deps, files, 'scheduled')).status).toBe('written')
      source.advance(24 * 60 * 60 * 1000)
    }
    const kept = [...stored.keys()].sort()
    expect(kept).toHaveLength(3)
    expect(kept).toContain(`${BACKUP_PREFIX}readme.txt`)
    expect(calls.filter((call) => call.startsWith('remove '))).toHaveLength(2)
    expect(calls.every((call) => !call.includes('readme'))).toBe(true)
  })

  it('takes one backup per BACKUP_REQUESTED_AT, and none when a newer one exists', async () => {
    await source.dispose()
    source = await harness({ BACKUP_REQUESTED_AT: String(Date.UTC(2026, 10, 18, 14, 0, 0)) })
    const { files, stored } = fakeFiles()
    expect((await runBackup(source.deps, files, 'requested')).status).toBe('written')
    source.advance(60_000)
    expect(await runBackup(source.deps, files, 'requested')).toEqual({ status: 'skipped', reason: 'already_satisfied' })
    expect(stored.size).toBe(1)

    // A fresh isolate (no memory) still sees the existing file and does not back up again.
    resetBackupMemory()
    expect(await runBackup(source.deps, files, 'requested')).toEqual({ status: 'skipped', reason: 'already_satisfied' })
    expect(stored.size).toBe(1)
  })

  it('is off without a public key or a files folder, and a failed upload prunes nothing', async () => {
    await source.dispose()
    source = await createHarness()
    expect(await runBackup(source.deps, fakeFiles().files, 'scheduled')).toEqual({ status: 'off', reason: 'no_public_key' })
    await source.dispose()
    source = await harness()
    expect(await runBackup(source.deps, undefined, 'scheduled')).toEqual({ status: 'off', reason: 'no_files' })

    const failing = fakeFiles({ failUpload: true })
    failing.stored.set(backupFileKey(Date.UTC(2026, 10, 1)), 'old')
    expect(await runBackup(source.deps, failing.files, 'scheduled')).toEqual({ status: 'failed', reason: 'upload' })
    expect(failing.calls.some((call) => call.startsWith('remove '))).toBe(false)
    expect(failing.stored.size).toBe(1)
  })
})
