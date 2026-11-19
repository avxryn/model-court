import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openCredential } from '../../src/server/credential-crypto'
import { createHarness, OTHER, OWNER, randomKeyB64, setupOwner, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const SENTINELS = ['sk-test-SENTINEL-OPENAI-KEY', 'sk-ant-SENTINEL-ANTHROPIC-KEY']

async function dumpTables(db: D1Database): Promise<string> {
  const tables = (await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all<{ name: string }>()).results
  let out = ''
  for (const { name } of tables) {
    if (name.startsWith('_cf') || name.startsWith('sqlite')) continue
    out += JSON.stringify((await db.prepare(`SELECT * FROM "${name}"`).all()).results)
  }
  return out
}

describe('T01 authentication boundary', () => {
  it('returns 401 for missing, malformed, and expired tokens', async () => {
    expect((await h.request('GET', '/evaluations')).status).toBe(401)
    expect((await h.request('GET', '/evaluations', { rawToken: 'not-a-jwt' })).status).toBe(401)
    const expired = await h.token(OWNER, -120)
    expect((await h.request('GET', '/evaluations', { rawToken: expired })).status).toBe(401)
    expect((await h.request('GET', '/evaluations', { as: OWNER })).status).toBe(200)
  })

  it('ignores caller-supplied identity headers', async () => {
    const setup = await setupOwner(h)
    const res = await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OTHER, headers: { 'x-user-id': OWNER } })
    expect(res.status).toBe(404)
  })

  it('marks private responses no-store and carries a request id', async () => {
    const res = await h.request('GET', '/evaluations', { as: OWNER })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.json.requestId).toMatch(/^req_/)
  })
})

describe('T02 evaluation ownership and revisions', () => {
  it('isolates evaluations and returns a uniform 404 to unrelated users', async () => {
    const setup = await setupOwner(h)
    const missing = await h.request('GET', `/evaluations/${crypto.randomUUID()}`, { as: OTHER })
    const foreign = await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OTHER })
    expect(foreign.status).toBe(404)
    expect(foreign.json.error).toEqual(missing.json.error)
    const { schemaVersion: _v, ...draftBody } = setup.draft
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OTHER, ifMatch: 1, body: draftBody })).status).toBe(404)
    const list = await h.request('GET', '/evaluations', { as: OTHER })
    expect(list.json.data.items).toEqual([])
  })

  it('saves drafts under If-Match and refuses stale revisions', async () => {
    const setup = await setupOwner(h)
    const draft = { comparisonMode: setup.draft.comparisonMode, cases: setup.draft.cases, configurations: setup.draft.configurations }
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, body: draft })).status).toBe(428)
    const first = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })
    expect(first.json.data.revision).toBe(2)
    const stale = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })
    expect(stale.status).toBe(409)
    expect(stale.json.error.code).toBe('REVISION_CONFLICT')
  })

  it('rejects invalid drafts with field errors (T03 at the API)', async () => {
    const setup = await setupOwner(h)
    const draft = { comparisonMode: 'model', cases: [{ ...setup.draft.cases[0], input: '' }], configurations: setup.draft.configurations }
    const res = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })
    expect(res.status).toBe(422)
    expect(res.json.error.fields[0].path).toBe('cases.0.input')
    const unknown = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: { ...draft, billingMode: 'platform' } })
    expect(unknown.status).toBe(422)
  })

  it('rejects oversized bodies with 413', async () => {
    const setup = await setupOwner(h)
    const res = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: { padding: 'x'.repeat(130 * 1024) } })
    expect(res.status).toBe(413)
  })
})

describe('T31/T32 credential custody', () => {
  it('stores only ciphertext, returns only safe metadata, and decrypts with the bound AAD', async () => {
    await setupOwner(h)
    const dump = await dumpTables(h.db)
    for (const sentinel of SENTINELS) expect(dump).not.toContain(sentinel)
    expect(JSON.stringify(h.logs)).not.toContain('SENTINEL')

    const list = await h.request('GET', '/credentials', { as: OWNER })
    expect(list.status).toBe(200)
    for (const item of list.json.data.items) {
      expect(Object.keys(item).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'label', 'lastCheckResult', 'lastCheckedAt', 'lastUsedAt', 'lastUsedRunId', 'provider', 'revision', 'status'])
    }
    expect(list.text).not.toContain('SENTINEL')

    const row = await h.db.prepare(`SELECT * FROM provider_credentials WHERE provider = 'openai'`).first<any>()
    const root = h.deps.config.encryptionKeys.get('v1')!
    const binding = { appId: 'app_test', credentialId: row.id, ownerUserId: OWNER, provider: 'openai', keyVersion: 'v1' }
    expect(await openCredential(root, binding, { ciphertext: row.ciphertext, nonce: row.nonce })).toBe(SENTINELS[0])

    // Tampered ciphertext, changed owner, changed provider, wrong root: all rejected.
    const flipped = Buffer.from(row.ciphertext, 'base64')
    flipped[0] ^= 1
    await expect(openCredential(root, binding, { ciphertext: flipped.toString('base64'), nonce: row.nonce })).rejects.toThrow()
    await expect(openCredential(root, { ...binding, ownerUserId: OTHER }, row)).rejects.toThrow()
    await expect(openCredential(root, { ...binding, provider: 'anthropic' }, row)).rejects.toThrow()
    const wrongRoot = Uint8Array.from(Buffer.from(randomKeyB64(), 'base64'))
    await expect(openCredential(wrongRoot, binding, row)).rejects.toThrow()
  })

  it('makes no provider request when saving a key', async () => {
    await setupOwner(h)
    expect(h.providerCalls).toHaveLength(0)
  })

  it('refuses a key that belongs to another company with KEY_PROVIDER_MISMATCH, storing and sending nothing (spec 07 §8.2)', async () => {
    const cases: Array<[string, string, RegExp]> = [
      ['anthropic', 'sk-proj-SENTINEL-WRONG', /looks like an OpenAI key\. Paste it on the OpenAI card/],
      ['openai', 'sk-ant-api03-SENTINEL-WRONG', /looks like an Anthropic key\. Paste it on the Anthropic card/],
      ['openai', 'sk-or-v1-SENTINEL-WRONG', /looks like an OpenRouter key\. Model Court does not take OpenRouter keys/],
    ]
    for (const [provider, apiKey, message] of cases) {
      const res = await h.request('POST', '/credentials', { as: OWNER, body: { provider, label: 'Wrong card', apiKey, consentToStorage: true } })
      expect(res.status, apiKey).toBe(422)
      expect(res.json.error.code).toBe('KEY_PROVIDER_MISMATCH')
      expect(res.json.error.message).toMatch(message)
      expect(res.text).not.toContain(apiKey)
    }
    expect(h.providerCalls).toHaveLength(0)
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM provider_credentials').first<{ n: number }>())?.n).toBe(0)
    expect(JSON.stringify(h.logs)).not.toContain('SENTINEL-WRONG')
  })

  it('allows one active key per provider, atomic replace, and idempotent replay without secrets in receipts', async () => {
    const setup = await setupOwner(h)
    const dup = await h.request('POST', '/credentials', { as: OWNER, body: { provider: 'openai', label: 'Second', apiKey: 'sk-other', consentToStorage: true } })
    expect(dup.status).toBe(409)

    const key = crypto.randomUUID()
    const body = { provider: 'openai', label: 'Rotated', apiKey: 'sk-rotated-SENTINEL', consentToStorage: true, replacesCredentialId: setup.openaiKeyId }
    expect((await h.request('POST', '/credentials', { as: OWNER, idempotencyKey: key, body })).status).toBe(428)
    h.advance(61_000) // stay under the 5-per-minute credential mutation limit
    const replaceKey = crypto.randomUUID()
    const replaced = await h.request('POST', '/credentials', { as: OWNER, idempotencyKey: replaceKey, ifMatch: 1, body })
    expect(replaced.status).toBe(201)
    expect(replaced.json.data.id).not.toBe(setup.openaiKeyId)
    const replay = await h.request('POST', '/credentials', { as: OWNER, idempotencyKey: replaceKey, ifMatch: 1, body })
    expect(replay.status).toBe(201)
    expect(replay.json.data.id).toBe(replaced.json.data.id)
    const fresh = await h.request('POST', '/credentials', { as: OWNER, idempotencyKey: crypto.randomUUID(), ifMatch: 1, body })
    expect(fresh.status).toBe(409) // the replaced key is revoked; replacing it again is refused

    const old = await h.db.prepare('SELECT status, ciphertext, nonce FROM provider_credentials WHERE id = ?').bind(setup.openaiKeyId).first<any>()
    expect(old).toEqual({ status: 'revoked', ciphertext: null, nonce: null })
    const receipts = JSON.stringify((await h.db.prepare('SELECT * FROM command_receipts').all()).results)
    expect(receipts).not.toContain('SENTINEL')
    expect(receipts).not.toContain('sk-')
  })

  it('replays the same idempotency key with current metadata, not a new key', async () => {
    const key = crypto.randomUUID()
    const body = { provider: 'anthropic', label: 'Mine', apiKey: 'sk-ant-REPLAY', consentToStorage: true }
    const first = await h.request('POST', '/credentials', { as: OWNER, idempotencyKey: key, body })
    const second = await h.request('POST', '/credentials', { as: OWNER, idempotencyKey: key, body })
    expect(second.status).toBe(201)
    expect(second.json.data.id).toBe(first.json.data.id)
    expect((await h.db.prepare(`SELECT COUNT(*) AS n FROM provider_credentials`).first<any>()).n).toBe(1)
    const conflict = await h.request('POST', '/credentials', { as: OWNER, idempotencyKey: key, body: { ...body, label: 'Different' } })
    expect(conflict.json.error.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('denies cross-user credential removal and lets the owner remove repeatedly', async () => {
    const setup = await setupOwner(h)
    expect((await h.request('DELETE', `/credentials/${setup.openaiKeyId}`, { as: OTHER, ifMatch: 1 })).status).toBe(404)
    expect((await h.request('DELETE', `/credentials/${setup.openaiKeyId}`, { as: OWNER })).status).toBe(428)
    expect((await h.request('DELETE', `/credentials/${setup.openaiKeyId}`, { as: OWNER, ifMatch: 1 })).status).toBe(204)
    expect((await h.request('DELETE', `/credentials/${setup.openaiKeyId}`, { as: OWNER, ifMatch: 1 })).status).toBe(204)
  })

  it('keeps removal available when credential writes and generation are disabled', async () => {
    const setup = await setupOwner(h)
    h.env.CREDENTIAL_WRITES_ENABLED = 'false'
    h.env.GENERATION_ENABLED = 'false'
    delete h.env.CREDENTIAL_ENCRYPTION_KEY_V1
    const save = await h.request('POST', '/credentials', { as: OWNER, body: { provider: 'openai', label: 'x', apiKey: 'sk-x', consentToStorage: true } })
    expect(save.status).toBe(503)
    expect((await h.request('DELETE', `/credentials/${setup.anthropicKeyId}`, { as: OWNER, ifMatch: 1 })).status).toBe(204)
  })

  it('rejects mutations from another origin', async () => {
    const res = await h.request('POST', '/evaluations', { as: OWNER, headers: { Origin: 'https://evil.example' }, body: { title: 'x', taskDescription: '' } })
    expect(res.status).toBe(403)
  })
})
