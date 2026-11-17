/**
 * D-23 key safeguards: admin-key rejection, expiry (enforced before decrypt
 * and swept by cron through the normal revocation path), renewal, last use.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMaintenance } from '../../src/server/services/maintenance'
import { createHarness, OWNER, setupOwner, startRun, type Harness } from './harness'

const DAY = 24 * 60 * 60 * 1000
let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

async function credentials() {
  return (await h.request('GET', '/credentials', { as: OWNER })).json.data.items as Array<Record<string, any>>
}

describe('admin-key rejection', () => {
  it.each([
    ['openai', 'sk-admin-ABCDEF0123456789'],
    ['anthropic', 'sk-ant-admin01-ABCDEF0123456789'],
  ])('refuses a %s admin key at save, without storing anything', async (provider, apiKey) => {
    const res = await h.request('POST', '/credentials', { as: OWNER, body: { provider, label: 'Admin', apiKey, consentToStorage: true } })
    expect(res.status).toBe(422)
    expect(res.json.error.fields[0]).toMatchObject({ path: 'apiKey' })
    expect(res.text).not.toContain(apiKey)
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM provider_credentials').first<any>()).n).toBe(0)
  })

  it('accepts ordinary project/workspace keys', async () => {
    const res = await h.request('POST', '/credentials', { as: OWNER, body: { provider: 'openai', label: 'Project', apiKey: 'sk-proj-ABCDEF0123456789', consentToStorage: true } })
    expect(res.status).toBe(201)
  })
})

describe('key expiry and renewal', () => {
  it('sets a 7-day expiry by default and renewal extends it', async () => {
    await setupOwner(h)
    const [key] = await credentials()
    expect(key.expiresAt).toBe(h.now() + 7 * DAY)
    h.advance(3 * DAY)
    const renewed = await h.request('POST', `/credentials/${key.id}/renew`, { as: OWNER, ifMatch: key.revision, body: {} })
    expect(renewed.status).toBe(200)
    expect(renewed.json.data.expiresAt).toBe(h.now() + 7 * DAY)
    expect((await h.request('POST', `/credentials/${key.id}/renew`, { as: OWNER, ifMatch: key.revision, body: {} })).status).toBe(409) // stale revision
  })

  it('never decrypts an expired key, even before the cron sweep, and releases the unsent reservations', async () => {
    const setup = await setupOwner(h)
    await startRun(h, setup)
    h.advance(7 * DAY + 1)
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(0)
    const codes = (await h.db.prepare('SELECT DISTINCT last_error_code AS c FROM generations').all<any>()).results.map((r) => r.c)
    expect(codes).toEqual(['CREDENTIAL_EXPIRED'])
    const bucket = await h.db.prepare('SELECT allocated_units FROM budget_buckets WHERE subject = ?').bind(`user:${OWNER}`).first<any>()
    expect(bucket.allocated_units).toBe(0)
  })

  it('cron revokes expired keys through the normal revocation path and blocks new runs', async () => {
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId
    h.advance(7 * DAY + 1)
    const report = await runMaintenance(h.deps)
    expect(report.credentialsExpired).toBe(2)
    const rows = (await h.db.prepare('SELECT status, ciphertext, nonce FROM provider_credentials').all<any>()).results
    expect(rows.every((r) => r.status === 'revoked' && r.ciphertext === null && r.nonce === null)).toBe(true)
    // Queued work was fenced without any provider request.
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(0)
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    expect(view.status).toBe('ready')
    expect(view.generations.every((g: any) => g.errorCode === 'CREDENTIAL_REVOKED')).toBe(true)
    expect(await credentials()).toEqual([])
    const audit = await h.db.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'credential.expire'`).first<any>()
    expect(audit.n).toBe(2)
  })

  it('refuses to pin an expired key to a new run', async () => {
    const setup = await setupOwner(h)
    h.advance(7 * DAY + 1)
    const res = await startRun(h, setup)
    expect(res.json.error.code).toBe('CREDENTIAL_MISSING')
    expect(res.json.error.message).toMatch(/expired/)
  })
})

describe('last-used metadata', () => {
  it('records when and for which run a key was decrypted, never the key', async () => {
    const setup = await setupOwner(h)
    const before = await credentials()
    expect(before.every((k) => k.lastUsedAt === null)).toBe(true)
    const runId = (await startRun(h, setup)).json.data.runId
    await h.drainJobs()
    const after = await h.request('GET', '/credentials', { as: OWNER })
    for (const key of after.json.data.items) {
      expect(key.lastUsedAt).toBe(h.now())
      expect(key.lastUsedRunId).toBe(runId)
    }
    expect(after.text).not.toContain('SENTINEL')
  })
})
