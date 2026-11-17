/**
 * Operator re-keying (runbook "Root-key rotation" step 3) and post-restore
 * revocation. Runs on both stores (local D1 and the ModelCourtStore Durable Object).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openCredential } from '../../src/server/credential-crypto'
import { rekeyCredentials, revokeCredentialsCreatedBefore, runCredentialOps } from '../../src/server/services/credential-ops'
import { createHarness, OTHER, OWNER, randomKeyB64, setupOwner, startRun, type Harness } from './harness'

const SENTINELS = ['sk-test-SENTINEL-OPENAI-KEY', 'sk-ant-SENTINEL-ANTHROPIC-KEY']
let h: Harness
beforeEach(async () => {
  h = await createHarness()
  h.env.CREDENTIAL_ENCRYPTION_KEY_V2 = randomKeyB64()
})
afterEach(async () => {
  await h.dispose()
})

interface Row {
  id: string
  owner_user_id: string
  provider: string
  status: string
  ciphertext: string | null
  nonce: string | null
  encryption_key_version: string | null
  revision: number
  expires_at: number | null
  revoked_at: number | null
}

async function rows(): Promise<Row[]> {
  return (await h.db.prepare('SELECT * FROM provider_credentials ORDER BY id').all<Row>()).results
}

function root(version: string): Uint8Array<ArrayBuffer> {
  const key = h.deps.config.encryptionKeys.get(version)
  if (!key) throw new Error(`no root ${version}`)
  return key
}

async function open(row: Row, version = row.encryption_key_version!): Promise<string> {
  return openCredential(root(version), { appId: 'app_test', credentialId: row.id, ownerUserId: row.owner_user_id, provider: row.provider, keyVersion: version }, { ciphertext: row.ciphertext!, nonce: row.nonce! })
}

async function dumpEverything(): Promise<string> {
  const tables = ['provider_credentials', 'audit_events', 'command_receipts', 'outbox', 'generations']
  const parts = await Promise.all(tables.map(async (table) => JSON.stringify((await h.db.prepare(`SELECT * FROM ${table}`).all()).results)))
  return parts.join('\n') + JSON.stringify(h.logs)
}

describe('re-keying active credentials', () => {
  it('re-encrypts every active key under the target root with a fresh nonce, keeping revision and expiry', async () => {
    await setupOwner(h)
    const before = await rows()
    const report = await rekeyCredentials(h.deps, { targetVersion: 'v2' })
    expect(report).toMatchObject({ targetVersion: 'v2', rekeyed: 2, unreadable: 0, rootMissing: 0, skipped: 0, remaining: 0 })
    const after = await rows()
    for (const [index, row] of after.entries()) {
      const old = before[index]
      expect(row.encryption_key_version).toBe('v2')
      expect(row.nonce).not.toBe(old.nonce)
      expect(row.ciphertext).not.toBe(old.ciphertext)
      expect({ revision: row.revision, expires_at: row.expires_at, status: row.status }).toEqual({ revision: old.revision, expires_at: old.expires_at, status: 'active' })
      // Same canonical AAD, now naming v2: opens under v2, never under v1.
      expect(SENTINELS).toContain(await open(row, 'v2'))
      await expect(open({ ...row, encryption_key_version: 'v1' }, 'v1')).rejects.toThrow('Credential could not be decrypted.')
    }
    const audits = (await h.db.prepare(`SELECT outcome, metadata_json FROM audit_events WHERE event_type = 'credential.rekey'`).all<{ outcome: string; metadata_json: string }>()).results
    expect(audits).toHaveLength(2)
    expect(audits.every((audit) => audit.outcome === 'ok' && JSON.parse(audit.metadata_json).to === 'v2')).toBe(true)
  })

  it('keeps generation working after v1 is retired', async () => {
    const setup = await setupOwner(h)
    expect((await startRun(h, setup)).status).toBe(202)
    await rekeyCredentials(h.deps, { targetVersion: 'v2' })
    h.env.CREDENTIAL_ACTIVE_KEY_VERSION = 'v2'
    delete h.env.CREDENTIAL_ENCRYPTION_KEY_V1
    await h.drainJobs()
    const openai = h.providerCalls.find((call) => call.url.includes('openai'))
    const anthropic = h.providerCalls.find((call) => call.url.includes('anthropic'))
    expect(openai?.headers.authorization).toBe(`Bearer ${SENTINELS[0]}`)
    expect(anthropic?.headers['x-api-key']).toBe(SENTINELS[1])
  })

  it('is resumable in small batches and idempotent once done', async () => {
    await setupOwner(h)
    await setupOwner(h, OTHER)
    const first = await rekeyCredentials(h.deps, { targetVersion: 'v2', batchSize: 1, maxRows: 1 })
    expect(first).toMatchObject({ rekeyed: 1, remaining: 3 })
    const second = await rekeyCredentials(h.deps, { targetVersion: 'v2', batchSize: 2, maxRows: 2 })
    expect(second).toMatchObject({ rekeyed: 2, remaining: 1 })
    const third = await rekeyCredentials(h.deps, { targetVersion: 'v2', batchSize: 1 })
    expect(third).toMatchObject({ rekeyed: 1, remaining: 0 })
    const settled = await rows()
    const again = await rekeyCredentials(h.deps, { targetVersion: 'v2' })
    expect(again).toMatchObject({ rekeyed: 0, unreadable: 0, skipped: 0, remaining: 0 })
    expect(await rows()).toEqual(settled)
  })

  it('leaves revoked rows untouched', async () => {
    const setup = await setupOwner(h)
    expect((await h.request('DELETE', `/credentials/${setup.openaiKeyId}`, { as: OWNER, ifMatch: 1 })).status).toBe(204)
    const revokedBefore = (await rows()).find((row) => row.id === setup.openaiKeyId)
    expect(revokedBefore).toMatchObject({ status: 'revoked', ciphertext: null, nonce: null, encryption_key_version: null })
    const report = await rekeyCredentials(h.deps, { targetVersion: 'v2', revokeUnreadable: true })
    expect(report).toMatchObject({ rekeyed: 1, unreadable: 0, remaining: 0 })
    expect((await rows()).find((row) => row.id === setup.openaiKeyId)).toEqual(revokedBefore)
  })

  it('refuses tampered ciphertext: the row stays as it was and nothing else is blocked', async () => {
    const setup = await setupOwner(h)
    // Move the OpenAI ciphertext onto the Anthropic row: valid bytes, wrong AAD binding.
    const openaiRow = (await rows()).find((row) => row.id === setup.openaiKeyId)!
    await h.db.prepare('UPDATE provider_credentials SET ciphertext = ?, nonce = ? WHERE id = ?').bind(openaiRow.ciphertext, openaiRow.nonce, setup.anthropicKeyId).run()
    const tampered = (await rows()).find((row) => row.id === setup.anthropicKeyId)!
    const report = await rekeyCredentials(h.deps, { targetVersion: 'v2' })
    expect(report).toMatchObject({ rekeyed: 1, unreadable: 1, revokedUnreadable: 0, remaining: 1, unreadableCredentialIds: [setup.anthropicKeyId] })
    expect((await rows()).find((row) => row.id === setup.anthropicKeyId)).toEqual(tampered)

    // A flipped ciphertext byte is refused the same way.
    const bytes = Buffer.from(tampered.ciphertext!, 'base64')
    bytes[0] ^= 0x01
    await h.db.prepare('UPDATE provider_credentials SET ciphertext = ? WHERE id = ?').bind(bytes.toString('base64'), setup.anthropicKeyId).run()
    expect(await rekeyCredentials(h.deps, { targetVersion: 'v2' })).toMatchObject({ rekeyed: 0, unreadable: 1, remaining: 1 })

    // With the explicit operator flag the unreadable key is revoked through the normal path.
    const revoking = await rekeyCredentials(h.deps, { targetVersion: 'v2', revokeUnreadable: true })
    expect(revoking).toMatchObject({ unreadable: 1, revokedUnreadable: 1, remaining: 0 })
    expect((await rows()).find((row) => row.id === setup.anthropicKeyId)).toMatchObject({ status: 'revoked', ciphertext: null, nonce: null, encryption_key_version: null })
    const audit = await h.db.prepare(`SELECT outcome FROM audit_events WHERE event_type = 'credential.rekey' AND outcome = 'revoked'`).first<{ outcome: string }>()
    expect(audit?.outcome).toBe('revoked')
  })

  it('changes nothing when the wrong v1 root is configured, then succeeds once it is fixed', async () => {
    await setupOwner(h)
    const before = await rows()
    const correctV1 = h.env.CREDENTIAL_ENCRYPTION_KEY_V1
    h.env.CREDENTIAL_ENCRYPTION_KEY_V1 = randomKeyB64()
    const report = await rekeyCredentials(h.deps, { targetVersion: 'v2' })
    expect(report).toMatchObject({ rekeyed: 0, unreadable: 2, revokedUnreadable: 0, remaining: 2 })
    expect(await rows()).toEqual(before)
    h.env.CREDENTIAL_ENCRYPTION_KEY_V1 = correctV1
    expect(await rekeyCredentials(h.deps, { targetVersion: 'v2' })).toMatchObject({ rekeyed: 2, unreadable: 0, remaining: 0 })
  })

  it('skips rows whose recorded root is not configured', async () => {
    await setupOwner(h)
    const before = await rows()
    delete h.env.CREDENTIAL_ENCRYPTION_KEY_V1
    h.env.CREDENTIAL_ACTIVE_KEY_VERSION = 'v2'
    expect(await rekeyCredentials(h.deps, { targetVersion: 'v2' })).toMatchObject({ rekeyed: 0, rootMissing: 2, remaining: 2 })
    expect(await rows()).toEqual(before)
  })

  it('refuses an unconfigured target root', async () => {
    await expect(rekeyCredentials(h.deps, { targetVersion: 'v3' })).rejects.toThrow('not configured')
    h.env.CREDENTIAL_REKEY_TARGET_VERSION = 'v3'
    expect(h.deps.config.credentialOps.rekeyTargetVersion).toBeNull()
    expect(h.deps.config.problems.join(' ')).toContain('Re-key target root v3 is not configured')
  })

  it('never logs, returns, or stores plaintext', async () => {
    const setup = await setupOwner(h)
    const openaiRow = (await rows()).find((row) => row.id === setup.openaiKeyId)!
    await h.db.prepare('UPDATE provider_credentials SET ciphertext = ?, nonce = ? WHERE id = ?').bind(openaiRow.ciphertext, openaiRow.nonce, setup.anthropicKeyId).run()
    const report = await rekeyCredentials(h.deps, { targetVersion: 'v2', revokeUnreadable: true })
    h.env.CREDENTIAL_REKEY_TARGET_VERSION = 'v2'
    await runCredentialOps(h.deps)
    const dump = JSON.stringify(report) + (await dumpEverything())
    for (const sentinel of SENTINELS) expect(dump).not.toContain(sentinel)
    expect(dump).not.toContain('SENTINEL')
  })

  it('runs from the cron entry point only when [vars] enables it', async () => {
    await setupOwner(h)
    await runCredentialOps(h.deps)
    expect(h.logs.some((log) => log.event === 'credential.rekey')).toBe(false)
    h.env.CREDENTIAL_REKEY_TARGET_VERSION = 'v2'
    await runCredentialOps(h.deps)
    expect(h.logs.find((log) => log.event === 'credential.rekey')).toMatchObject({ targetVersion: 'v2', rekeyed: 2, remaining: 0, unreadableIds: null })
    expect((await rows()).every((row) => row.encryption_key_version === 'v2')).toBe(true)
  })
})

describe('post-restore revocation', () => {
  it('revokes every active key created before the cutoff, fences its work, and spares later keys', async () => {
    const setup = await setupOwner(h)
    expect((await startRun(h, setup)).status).toBe(202)
    h.advance(60_000)
    const cutoff = h.now()
    h.advance(60_000)
    const later = await h.request('POST', '/credentials', { as: OTHER, body: { provider: 'openai', label: 'After restore', apiKey: 'sk-test-LATER-KEY-000000', consentToStorage: true } })
    expect(later.status).toBe(201)

    h.env.CREDENTIAL_REVOKE_CREATED_BEFORE = String(cutoff)
    await runCredentialOps(h.deps)
    expect(h.logs.find((log) => log.event === 'credential.restore_revoke')).toMatchObject({ revoked: 2, remaining: 0 })
    const state = await rows()
    expect(state.filter((row) => row.status === 'active').map((row) => row.id)).toEqual([later.json.data.id])
    expect(state.filter((row) => row.status === 'revoked').every((row) => row.ciphertext === null && row.nonce === null)).toBe(true)
    const generations = (await h.db.prepare('SELECT status, last_error_code FROM generations').all<{ status: string; last_error_code: string }>()).results
    expect(generations.every((g) => g.status === 'failed' && g.last_error_code === 'CREDENTIAL_REVOKED')).toBe(true)

    // Leaving the setting in place is harmless.
    expect(await revokeCredentialsCreatedBefore(h.deps, cutoff)).toEqual({ revoked: 0, remaining: 0 })
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(0)
  })

  it('ignores a malformed cutoff (fail closed, reported as a problem)', () => {
    h.env.CREDENTIAL_REVOKE_CREATED_BEFORE = 'yesterday'
    expect(h.deps.config.credentialOps.revokeCreatedBefore).toBeNull()
    expect(h.deps.config.problems.join(' ')).toContain('CREDENTIAL_REVOKE_CREATED_BEFORE')
  })
})
