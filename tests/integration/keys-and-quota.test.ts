/**
 * D-57: "Check key" (a free list-models call, mocked here), re-pinning a
 * hearing to the judge's current key on retry, and the read-only quota
 * endpoint behind the Start dialog. No real provider is ever called.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, OTHER, OWNER, setupOwner, startRun, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const MINUTE = 61_000

async function auditRows(eventType: string) {
  return (await h.db.prepare('SELECT * FROM audit_events WHERE event_type = ? ORDER BY created_at').bind(eventType).all<any>()).results
}

describe('check key', () => {
  it('reports a valid key, records the time and result, and never returns or logs the key', async () => {
    const setup = await setupOwner(h)
    h.setProvider(async () => new Response('{"object":"list","data":[{"id":"gpt-6-luna"}]}', { status: 200 }))
    const res = await h.request('POST', `/credentials/${setup.openaiKeyId}/check`, { as: OWNER, body: {} })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ result: 'valid', reason: 'OK', checkedAt: h.now(), credential: { id: setup.openaiKeyId, lastCheckedAt: h.now(), lastCheckResult: 'valid' } })
    expect(res.text).not.toContain('SENTINEL')

    expect(h.providerCalls).toHaveLength(1)
    expect(h.providerCalls[0].url).toBe('https://api.openai.com/v1/models')
    expect(h.providerCalls[0].headers.authorization).toBe('Bearer sk-test-SENTINEL-OPENAI-KEY') // only on the wire to the fixed endpoint

    const listed = await h.request('GET', '/credentials', { as: OWNER })
    expect(listed.json.data.items.find((k: any) => k.id === setup.openaiKeyId)).toMatchObject({ lastCheckedAt: h.now(), lastCheckResult: 'valid', lastUsedAt: null })
    expect(JSON.stringify(h.logs)).not.toContain('SENTINEL')
    const audit = await auditRows('credential.check')
    expect(audit).toHaveLength(1)
    expect(audit[0].outcome).toBe('valid')
    expect(audit[0].metadata_json).not.toContain('SENTINEL')
    // A check is free: no budget bucket is touched.
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM budget_buckets').first<any>()).n).toBe(0)
  })

  it('reports a rejected key as invalid without echoing the provider message', async () => {
    const setup = await setupOwner(h)
    h.setProvider(async () => new Response('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key sk-ant-SENTINEL-ANTHROPIC-KEY"}}', { status: 401 }))
    const res = await h.request('POST', `/credentials/${setup.anthropicKeyId}/check`, { as: OWNER, body: {} })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ result: 'invalid', reason: 'AUTH_FAILED', credential: { lastCheckResult: 'invalid' } })
    expect(h.providerCalls[0].url.startsWith('https://api.anthropic.com/v1/models')).toBe(true)
    expect(h.providerCalls[0].headers['x-api-key']).toBe('sk-ant-SENTINEL-ANTHROPIC-KEY')
    expect(res.text).not.toContain('SENTINEL')
    expect(res.text).not.toContain('authentication_error')
  })

  it('reports a network failure as unreachable and redacts the error', async () => {
    const setup = await setupOwner(h)
    h.setProvider(async () => {
      throw new TypeError('fetch failed: sk-test-SENTINEL-OPENAI-KEY')
    })
    const res = await h.request('POST', `/credentials/${setup.openaiKeyId}/check`, { as: OWNER, body: {} })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ result: 'unreachable', reason: 'NETWORK_ERROR' })
    expect(res.text).not.toContain('SENTINEL')
    expect(res.text).not.toContain('fetch failed')
    expect(JSON.stringify(h.logs)).not.toContain('SENTINEL')
  })

  it("refuses another user's key, a removed key, and too many checks", async () => {
    const setup = await setupOwner(h)
    expect((await h.request('POST', `/credentials/${setup.openaiKeyId}/check`, { as: OTHER, body: {} })).status).toBe(404)
    expect(h.providerCalls).toHaveLength(0)

    await h.request('DELETE', `/credentials/${setup.anthropicKeyId}`, { as: OWNER, ifMatch: 1 })
    const removed = await h.request('POST', `/credentials/${setup.anthropicKeyId}/check`, { as: OWNER, body: {} })
    expect(removed.status).toBe(409)
    expect(h.providerCalls).toHaveLength(0)

    h.advance(MINUTE)
    h.setProvider(async () => new Response('{}', { status: 200 }))
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) statuses.push((await h.request('POST', `/credentials/${setup.openaiKeyId}/check`, { as: OWNER, body: {} })).status)
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true)
    expect(statuses[6]).toBe(429)
  })
})

describe('retry re-pins a removed key to the judge’s current key', () => {
  async function runWithRemovedOpenAiKey() {
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId as string
    h.advance(MINUTE)
    // Replacing the key revokes the pinned one; queued OpenAI work fails without being sent.
    const replaced = await h.request('POST', '/credentials', {
      as: OWNER,
      ifMatch: 1,
      body: { provider: 'openai', label: 'New OpenAI', apiKey: 'sk-test-SENTINEL-NEW-OPENAI', consentToStorage: true, replacesCredentialId: setup.openaiKeyId },
    })
    expect(replaced.status).toBe(201)
    await h.drainJobs()
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    expect(view.status).toBe('ready')
    return { setup, runId, newKeyId: replaced.json.data.id as string, view }
  }

  it('shows which pin is unusable, refuses a retry without a key, then re-pins and sends with the new key', async () => {
    const { setup, runId, newKeyId, view } = await runWithRemovedOpenAiKey()
    expect(view.pinnedKeys).toEqual([
      { provider: 'anthropic', credentialId: setup.anthropicKeyId, usable: true },
      { provider: 'openai', credentialId: setup.openaiKeyId, usable: false },
    ])
    const failed = view.generations.filter((g: any) => g.errorCode === 'CREDENTIAL_REVOKED')
    expect(failed.length).toBeGreaterThan(0)
    const ids = failed.map((g: any) => g.id)
    const callsBefore = h.providerCalls.length

    h.advance(MINUTE)
    const refused = await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: ids, acknowledgePossiblePriorCharge: true } })
    expect(refused.status).toBe(409)
    expect(refused.json.error.code).toBe('CREDENTIAL_MISSING')
    expect(refused.json.error.details).toEqual({ provider: 'openai', repinRequired: true })
    expect(refused.json.error.message).not.toMatch(/start a new one/i)

    const retry = await h.request('POST', `/runs/${runId}/retries`, {
      as: OWNER,
      ifMatch: view.revision,
      body: { generationIds: ids, acknowledgePossiblePriorCharge: true, credentialIdsByProvider: { openai: newKeyId } },
    })
    expect(retry.status).toBe(202)
    expect(retry.json.data.repinned).toEqual(['openai'])

    const pin = await h.db.prepare(`SELECT credential_id FROM run_credentials WHERE run_id = ? AND provider = 'openai'`).bind(runId).first<any>()
    expect(pin.credential_id).toBe(newKeyId)
    const audit = await auditRows('run.credential_repin')
    expect(audit).toHaveLength(1)
    expect(audit[0].run_id).toBe(runId)
    expect(JSON.parse(audit[0].metadata_json)).toEqual({ provider: 'openai', fromCredentialId: setup.openaiKeyId, toCredentialId: newKeyId })
    expect(audit[0].metadata_json).not.toContain('SENTINEL')

    await h.drainJobs()
    const sent = h.providerCalls.slice(callsBefore)
    expect(sent).toHaveLength(ids.length)
    expect(sent.every((call) => call.headers.authorization === 'Bearer sk-test-SENTINEL-NEW-OPENAI')).toBe(true)
    const after = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    expect(after.generations.every((g: any) => g.status === 'succeeded')).toBe(true)
    expect(after.pinnedKeys.find((p: any) => p.provider === 'openai')).toEqual({ provider: 'openai', credentialId: newKeyId, usable: true })
    expect(JSON.stringify(after)).not.toContain('SENTINEL')
  })

  it("refuses another user's key and leaves the pin alone", async () => {
    const { setup, runId, view } = await runWithRemovedOpenAiKey()
    const other = await setupOwner(h, OTHER)
    const ids = view.generations.filter((g: any) => g.errorCode === 'CREDENTIAL_REVOKED').map((g: any) => g.id)
    h.advance(MINUTE)
    const res = await h.request('POST', `/runs/${runId}/retries`, {
      as: OWNER,
      ifMatch: view.revision,
      body: { generationIds: ids, acknowledgePossiblePriorCharge: true, credentialIdsByProvider: { openai: other.openaiKeyId } },
    })
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('CREDENTIAL_MISSING')
    const pin = await h.db.prepare(`SELECT credential_id FROM run_credentials WHERE run_id = ? AND provider = 'openai'`).bind(runId).first<any>()
    expect(pin.credential_id).toBe(setup.openaiKeyId)
    expect(await auditRows('run.credential_repin')).toHaveLength(0)
  })

  it('keeps a usable pin even when another key id is offered', async () => {
    const setup = await setupOwner(h)
    h.setProvider(async (call) => (call.url.includes('openai') ? new Response('{"error":{}}', { status: 500 }) : new Response(JSON.stringify({ id: 'm', type: 'message', model: 'x', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }), { status: 200 })))
    const runId = (await startRun(h, setup)).json.data.runId as string
    await h.drainJobs()
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    const ids = view.generations.filter((g: any) => g.status === 'failed').map((g: any) => g.id)
    expect(ids.length).toBeGreaterThan(0)
    h.advance(MINUTE)
    const res = await h.request('POST', `/runs/${runId}/retries`, {
      as: OWNER,
      ifMatch: view.revision,
      body: { generationIds: ids, acknowledgePossiblePriorCharge: true, credentialIdsByProvider: { openai: setup.anthropicKeyId } },
    })
    expect(res.status).toBe(202)
    expect(res.json.data.repinned).toEqual([])
    const pin = await h.db.prepare(`SELECT credential_id FROM run_credentials WHERE run_id = ? AND provider = 'openai'`).bind(runId).first<any>()
    expect(pin.credential_id).toBe(setup.openaiKeyId)
  })

  it('the store refuses a pin move to a removed key or to another provider, even outside the service', async () => {
    const { setup, runId, newKeyId } = await runWithRemovedOpenAiKey()
    const update = (credentialId: string, provider = 'openai') => h.db.prepare('UPDATE run_credentials SET credential_id = ? WHERE run_id = ? AND provider = ?').bind(credentialId, runId, provider).run()
    await expect(update(setup.anthropicKeyId)).rejects.toThrow(/IMMUTABLE_RUN_CREDENTIALS/)
    await expect(update(newKeyId, 'anthropic')).rejects.toThrow(/IMMUTABLE_RUN_CREDENTIALS/)
    await expect(h.db.prepare(`UPDATE run_credentials SET provider = 'anthropic' WHERE run_id = ? AND provider = 'openai'`).bind(runId).run()).rejects.toThrow(/IMMUTABLE_RUN_CREDENTIALS|constraint/i)
  })
})

describe('quota', () => {
  it('reports the configured caps and what this judge and the deployment have left', async () => {
    const fresh = await h.request('GET', '/quota', { as: OWNER })
    expect(fresh.status).toBe(200)
    expect(fresh.json.data).toMatchObject({
      user: { limit: 20, used: 0, remaining: 20 },
      globalToday: { limit: 100, used: 0, remaining: 100 },
      globalLifetime: { limit: 500, used: 0, remaining: 500 },
      available: 20,
      resetsAt: Date.UTC(2026, 10, 19),
    })

    const setup = await setupOwner(h)
    const planned = (await startRun(h, setup)).json.data.plannedCalls as number
    expect(planned).toBe(10)
    const mine = (await h.request('GET', '/quota', { as: OWNER })).json.data
    expect(mine.user).toEqual({ limit: 20, used: 10, remaining: 10 })
    expect(mine.globalToday.remaining).toBe(90)
    expect(mine.globalLifetime.remaining).toBe(490)

    // Another judge sees only counts: their own allowance is untouched, the shared ones are not.
    const theirs = (await h.request('GET', '/quota', { as: OTHER })).json.data
    expect(theirs.user.remaining).toBe(20)
    expect(theirs.globalToday.remaining).toBe(90)
    expect(JSON.stringify(theirs)).not.toContain(OWNER)

    // The per-user window resets at UTC midnight; the lifetime cap does not.
    h.advance(24 * 60 * 60 * 1000)
    const tomorrow = (await h.request('GET', '/quota', { as: OWNER })).json.data
    expect(tomorrow.user.remaining).toBe(20)
    expect(tomorrow.globalLifetime.remaining).toBe(490)
  })

  it('agrees with the server-side gate: a hearing larger than what is left is refused', async () => {
    const small = await createHarness({ env: { MAX_DAILY_CALLS_PER_USER: '15' } })
    try {
      const setup = await setupOwner(small)
      expect((await startRun(small, setup)).status).toBe(202) // 10 of 15
      await small.drainJobs()
      const quota = (await small.request('GET', '/quota', { as: OWNER })).json.data
      expect(quota.available).toBe(5)
      const second = await small.request('POST', '/evaluations', { as: OWNER, body: { title: 'Second', taskDescription: '' } })
      small.advance(MINUTE)
      const refused = await startRun(small, { ...setup, evaluationId: second.json.data.id })
      expect(refused.status).toBe(429)
      expect(refused.json.error.code).toBe('QUOTA_EXHAUSTED')
      expect((await small.request('GET', '/quota', { as: OWNER })).json.data.available).toBe(5)
    } finally {
      await small.dispose()
    }
  })

  it('requires sign-in', async () => {
    expect((await h.request('GET', '/quota')).status).toBe(401)
  })
})
