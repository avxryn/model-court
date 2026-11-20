import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from '../../domain/canonical'
import type { StoreSnapshot } from './backup'
import { generateOperatorKeyPair, openSnapshotWith, sealSnapshotTo, SealError } from './backup-seal'
import { backupFileKey, backupsToPrune, exportedAtOfKey } from './store-backup'
import { parseConfig } from '../config'

async function snapshot(): Promise<StoreSnapshot> {
  const tables = { evaluations: [{ id: 'e1', title: 'PRIVATE-CASE-TITLE' }] }
  return {
    format: 'model-court-store-backup',
    version: 1,
    appId: 'app_test',
    exportedAt: Date.UTC(2026, 10, 19, 21, 4, 5, 123),
    migrations: ['0001_initial'],
    schema: [],
    tables,
    redactions: { credentialRowsRevoked: 0, credentialReceiptsDropped: 0, pdfChunksOmitted: 0 },
    contentDigest: await sha256Hex(canonicalJson(tables)),
  } as unknown as StoreSnapshot
}

describe('operator-sealed backups (D-117)', () => {
  it('round-trips with the private key, and the file carries no plaintext', async () => {
    const pair = await generateOperatorKeyPair()
    const original = await snapshot()
    const sealed = await sealSnapshotTo(pair.publicSpki, original)
    expect(JSON.stringify(sealed)).not.toContain('PRIVATE-CASE-TITLE')
    expect(sealed).toMatchObject({ format: 'model-court-store-backup', version: 2, appId: 'app_test', exportedAt: original.exportedAt, recipient: pair.recipient })
    expect(await openSnapshotWith(pair.privatePkcs8, sealed)).toEqual(original)
  })

  it('uses a fresh ephemeral key and nonce for every file', async () => {
    const pair = await generateOperatorKeyPair()
    const original = await snapshot()
    const [a, b] = [await sealSnapshotTo(pair.publicSpki, original), await sealSnapshotTo(pair.publicSpki, original)]
    expect(a.ephemeralKey).not.toBe(b.ephemeralKey)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('names the wrong key plainly and refuses a changed header or changed bytes', async () => {
    const pair = await generateOperatorKeyPair()
    const other = await generateOperatorKeyPair()
    const sealed = await sealSnapshotTo(pair.publicSpki, await snapshot())
    await expect(openSnapshotWith(other.privatePkcs8, sealed)).rejects.toThrow(`sealed to key ${pair.recipient}`)
    await expect(openSnapshotWith(pair.privatePkcs8, { ...sealed, exportedAt: sealed.exportedAt + 1 })).rejects.toThrow(SealError)
    await expect(openSnapshotWith(pair.privatePkcs8, { ...sealed, appId: 'app_other' })).rejects.toThrow(SealError)
    const bytes = Buffer.from(sealed.ciphertext, 'base64')
    bytes[10] ^= 1
    await expect(openSnapshotWith(pair.privatePkcs8, { ...sealed, ciphertext: bytes.toString('base64') })).rejects.toThrow('altered')
    await expect(openSnapshotWith(pair.privatePkcs8, { ...sealed, version: 1 as never })).rejects.toThrow('version 2')
  })

  it('refuses a public key that is not P-256', async () => {
    await expect(sealSnapshotTo('bm90IGEga2V5', await snapshot())).rejects.toThrow('BACKUP_PUBLIC_KEY')
  })
})

describe('backup file names and retention (D-117)', () => {
  it('reads the export time back from the file name', () => {
    const at = Date.UTC(2026, 10, 19, 21, 4, 5, 123)
    expect(backupFileKey(at)).toBe('model-court-backups/2026-11-19T21-04-05-123Z.json')
    expect(exportedAtOfKey(backupFileKey(at))).toBe(at)
    expect(exportedAtOfKey('model-court-backups/notes.txt')).toBeNull()
    expect(exportedAtOfKey('elsewhere/2026-11-19T21-04-05-123Z.json')).toBeNull()
  })

  it('prunes only the oldest backups beyond the limit and never touches other files', () => {
    const keys = [1, 5, 3, 4, 2].map((day) => backupFileKey(Date.UTC(2026, 10, day)))
    expect(backupsToPrune([...keys, 'model-court-backups/readme.txt'], 3)).toEqual([backupFileKey(Date.UTC(2026, 10, 2)), backupFileKey(Date.UTC(2026, 10, 1))])
    expect(backupsToPrune(keys, 0)).toHaveLength(4)
    expect(backupsToPrune(keys, 10)).toEqual([])
  })
})

describe('backup configuration (D-117)', () => {
  it('turns backups on only with a P-256 public key, and never makes the app unready', async () => {
    const pair = await generateOperatorKeyPair()
    const on = parseConfig({ DEEPSPACE_APP_ID: 'app_test', BACKUP_PUBLIC_KEY: pair.publicSpki, BACKUP_KEEP: '5', BACKUP_REQUESTED_AT: '1763600000000' })
    expect(on.backup).toEqual({ publicKey: pair.publicSpki, keep: 5, requestedAt: 1763600000000, problems: [] })
    expect(parseConfig({ DEEPSPACE_APP_ID: 'app_test' }).backup).toEqual({ publicKey: null, keep: 14, requestedAt: null, problems: [] })
    const bad = parseConfig({ DEEPSPACE_APP_ID: 'app_test', BACKUP_PUBLIC_KEY: 'bm90IGEga2V5', BACKUP_KEEP: '0', BACKUP_REQUESTED_AT: 'soon' })
    expect(bad.backup.publicKey).toBeNull()
    expect(bad.backup.keep).toBe(14)
    expect(bad.backup.requestedAt).toBeNull()
    expect(bad.backup.problems).toHaveLength(3)
    expect(bad.problems.some((problem) => problem.includes('BACKUP'))).toBe(false)
  })
})
