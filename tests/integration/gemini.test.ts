/**
 * Spec 07 §11.2 (D-108): Google as a third BYOK provider, end to end against a fake `providerFetch`
 * (no network, no paid call). Saving and checking a Google key, a three-provider hearing, blinding,
 * revocation fencing only Google work, retry with a re-pin, the special master on a Gemini route, and
 * an outbound refusal that records a definite failure and gives its unit back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anthropicOk, createHarness, googleOk, okStub, openAiOk, openDeliberation, OWNER, REVIEWER, setupOwner, type Harness, type ProviderStub } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const GOOGLE_KEY = 'AIzaSENTINEL-GOOGLE-KEY-123'
const GEMINI = 'google-gemini-3-6-flash'

async function saveGoogleKey(apiKey = GOOGLE_KEY, extra: Record<string, unknown> = {}) {
  return h.request('POST', '/credentials', { as: OWNER, body: { provider: 'google', label: 'Test Google', apiKey, consentToStorage: true, ...extra } })
}

/** OpenAI, Anthropic and a Gemini party, in configuration mode. */
async function setupThreeProviders() {
  const setup = await setupOwner(h)
  const google = await saveGoogleKey()
  expect(google.status, JSON.stringify(google.json)).toBe(201)
  const { schemaVersion: _v, ...draft } = setup.draft
  draft.comparisonMode = 'configuration'
  draft.configurations.push({ ...draft.configurations[0], key: crypto.randomUUID(), label: 'Gemini', modelKey: GEMINI })
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  return { ...setup, googleKeyId: google.json.data.id as string, revision: saved.json.data.revision as number, draft }
}

async function start(setup: Awaited<ReturnType<typeof setupThreeProviders>>, keys?: Record<string, string>) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: setup.revision, credentialIdsByProvider: keys ?? { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId, google: setup.googleKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

const googleCalls = () => h.providerCalls.filter((call) => call.url.startsWith('https://generativelanguage.googleapis.com/'))

describe('Google keys', () => {
  it('saves a Google key, checks it with one free list-models GET, and never echoes or stores the plaintext', async () => {
    h.setProvider(async (call) => (call.url.includes('googleapis') ? new Response('{"models":[]}', { status: 200 }) : okStub(call, new AbortController().signal)))
    const saved = await saveGoogleKey()
    expect(saved.status).toBe(201)
    expect(saved.text).not.toContain(GOOGLE_KEY)
    // Check key is on by default when saving (D-59).
    const check = await h.request('POST', `/credentials/${saved.json.data.id}/check`, { as: OWNER, body: {} })
    expect(check.status).toBe(200)
    expect(check.text).not.toContain(GOOGLE_KEY)
    const call = googleCalls().at(-1)!
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1')
    expect(call.url).not.toMatch(/key=/)
    expect(call.headers['x-goog-api-key']).toBe(GOOGLE_KEY)
    const rows = await h.db.prepare(`SELECT * FROM provider_credentials WHERE provider = 'google'`).all<Record<string, unknown>>()
    expect(JSON.stringify(rows.results)).not.toContain(GOOGLE_KEY)
    expect(JSON.stringify(h.logs)).not.toContain(GOOGLE_KEY)
    const audits = await h.db.prepare('SELECT metadata_json FROM audit_events').all<{ metadata_json: string }>()
    expect(JSON.stringify(audits.results)).not.toContain(GOOGLE_KEY)
  })

  it('reports a Google 400 API_KEY_INVALID as invalid, reading only the reason token', async () => {
    const saved = await saveGoogleKey()
    h.setProvider(async () => new Response(JSON.stringify({ error: { code: 400, message: `API key not valid: ${GOOGLE_KEY}`, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 }))
    const check = await h.request('POST', `/credentials/${saved.json.data.id}/check`, { as: OWNER, body: {} })
    expect(check.json.data).toMatchObject({ result: 'invalid' })
    expect(check.text).not.toContain('not valid')
  })

  it('refuses a key that belongs to another company with KEY_PROVIDER_MISMATCH, before anything is stored or sent', async () => {
    const cases: Array<[string, string, RegExp]> = [
      ['google', 'sk-proj-SENTINEL', /OpenAI key\. Paste it on the OpenAI card/],
      ['google', 'sk-ant-api03-SENTINEL', /Anthropic key\. Paste it on the Anthropic card/],
      ['openai', 'AIzaSENTINEL', /Google key\. Paste it on the Google card/],
      ['anthropic', 'AIzaSENTINEL', /Google key\. Paste it on the Google card/],
      ['openai', 'sk-or-v1-SENTINEL', /OpenRouter key\. Model Court does not take OpenRouter keys/],
    ]
    for (const [provider, apiKey, message] of cases) {
      const res = await h.request('POST', '/credentials', { as: OWNER, body: { provider, label: 'Wrong', apiKey, consentToStorage: true } })
      expect(res.status, `${provider} ${apiKey}`).toBe(422)
      expect(res.json.error.code).toBe('KEY_PROVIDER_MISMATCH')
      expect(res.json.error.message).toMatch(message)
      expect(res.text).not.toContain(apiKey)
    }
    expect(h.providerCalls).toEqual([])
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM provider_credentials').first<{ n: number }>())?.n).toBe(0)
  })
})

describe('a three-provider hearing', () => {
  it('pins three keys, sends Gemini its own body with store off, and keeps providers hidden from jurors', async () => {
    const setup = await setupThreeProviders()
    const started = await start(setup)
    expect(started.status, JSON.stringify(started.json)).toBe(202)
    const runId = started.json.data.runId as string
    const pins = await h.db.prepare('SELECT provider, credential_id FROM run_credentials WHERE run_id = ? ORDER BY provider').bind(runId).all<{ provider: string; credential_id: string }>()
    expect(pins.results).toEqual([
      { provider: 'anthropic', credential_id: setup.anthropicKeyId },
      { provider: 'google', credential_id: setup.googleKeyId },
      { provider: 'openai', credential_id: setup.openaiKeyId },
    ])
    await h.drainJobs()
    const calls = googleCalls()
    expect(calls.length).toBe(setup.draft.cases.length)
    for (const call of calls) {
      expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent')
      expect(call.headers['x-goog-api-key']).toBe(GOOGLE_KEY)
      expect(call.headers.authorization).toBeUndefined()
      expect(call.body.store).toBe(false)
      expect(call.body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'minimal' } })
    }
    // No other provider's key reached Google, and the Google key went nowhere else.
    for (const call of h.providerCalls) {
      const google = call.url.startsWith('https://generativelanguage.googleapis.com/')
      expect(JSON.stringify(call.headers).includes(GOOGLE_KEY)).toBe(google)
      if (google) expect(JSON.stringify(call.headers)).not.toMatch(/SENTINEL-(OPENAI|ANTHROPIC)/)
    }
    // Jurors: labels only, no provider, model or usage.
    await openDeliberation(h, runId)
    const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: new URL(invite.json.data.url).hash.replace('#token=', '') } })
    const review = await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })
    expect(review.status).toBe(200)
    for (const word of ['google', 'Google', 'gemini', 'Gemini', 'openai', 'anthropic', 'inputTokens', 'durationMs', 'modelKey']) expect(review.text, word).not.toContain(word)
    expect(review.json.data.cases[0].responses.map((r: { label: string }) => r.label).sort()).toEqual(['A', 'B', 'C'])
    const runView = await h.request('GET', `/runs/${runId}`, { as: REVIEWER })
    for (const word of ['google', 'gemini', 'Gemini']) expect(runView.text, word).not.toContain(word)
  })

  it('revoking the Google key fences only Google work; a retry re-pins to a new Google key', async () => {
    const setup = await setupThreeProviders()
    // Gemini fails definitely, the others succeed.
    h.setProvider(async (call, signal) => (call.url.includes('googleapis') ? new Response('{"error":{"code":503,"status":"UNAVAILABLE"}}', { status: 503 }) : okStub(call, signal)))
    const runId = (await start(setup)).json.data.runId as string
    await h.drainJobs()
    const failed = await h.db.prepare(`SELECT id FROM generations WHERE run_id = ? AND provider = 'google' AND status = 'failed'`).bind(runId).all<{ id: string }>()
    expect(failed.results.length).toBe(setup.draft.cases.length)
    expect((await h.db.prepare(`SELECT COUNT(*) AS n FROM generations WHERE run_id = ? AND provider <> 'google' AND status = 'succeeded'`).bind(runId).first<{ n: number }>())?.n).toBe(setup.draft.cases.length * 2)

    // Remove the Google key; OpenAI and Anthropic pins are untouched.
    const keys = (await h.request('GET', '/credentials', { as: OWNER })).json.data.items as Array<{ id: string; provider: string; revision: number }>
    const google = keys.find((k) => k.provider === 'google')!
    expect((await h.request('DELETE', `/credentials/${google.id}`, { as: OWNER, ifMatch: google.revision })).status).toBe(204)
    const statuses = await h.db.prepare(`SELECT c.provider, c.status FROM run_credentials p JOIN provider_credentials c ON c.id = p.credential_id WHERE p.run_id = ? ORDER BY c.provider`).bind(runId).all()
    expect(statuses.results).toEqual([
      { provider: 'anthropic', status: 'active' },
      { provider: 'google', status: 'revoked' },
      { provider: 'openai', status: 'active' },
    ])

    // A new Google key, then a retry that re-pins only the Google slot (D-59).
    h.setProvider(okStub)
    const second = await saveGoogleKey('AIzaSENTINEL-GOOGLE-KEY-456')
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    const retried = await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: failed.results.map((g) => g.id), acknowledgePossiblePriorCharge: true, credentialIdsByProvider: { google: second.json.data.id } } })
    expect(retried.status, JSON.stringify(retried.json)).toBe(202)
    expect(retried.json.data.repinned).toEqual(['google'])
    await h.drainJobs()
    const pin = await h.db.prepare(`SELECT credential_id FROM run_credentials WHERE run_id = ? AND provider = 'google'`).bind(runId).first<{ credential_id: string }>()
    expect(pin?.credential_id).toBe(second.json.data.id)
    expect(googleCalls().at(-1)!.headers['x-goog-api-key']).toBe('AIzaSENTINEL-GOOGLE-KEY-456')
    expect((await h.db.prepare(`SELECT COUNT(*) AS n FROM generations WHERE run_id = ? AND status = 'succeeded'`).bind(runId).first<{ n: number }>())?.n).toBe(setup.draft.cases.length * 3)
  })

  it('records the setup metrics for the Gemini party with its own price', async () => {
    // The harness clock starts on 2026-11-18, before Gemini prices were read; a day later they apply.
    h.advance(24 * 60 * 60 * 1000)
    const setup = await setupThreeProviders()
    const runId = (await start(setup)).json.data.runId as string
    await h.drainJobs()
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
    const saved = await h.request('PUT', `/runs/${runId}/review`, { as: OWNER, ifMatch: review.sessionRevision, body: { ratings } })
    expect((await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.priceTable.version).toBe('2026-11-19.1')
    const gemini = results.setupMetrics[setup.draft.configurations[2].key]
    expect(gemini.cost.status).toBe('estimated')
    expect(gemini.cost.hearingMicroUsd).toBeGreaterThan(0)
    expect(gemini.tokens.totalReasoning).toBeGreaterThan(0)
  })

  it('says on the record when Google answers from another model than the one asked for (D-115)', async () => {
    const unseal = async (runId: string) => {
      const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
      const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
      const saved = await h.request('PUT', `/runs/${runId}/review`, { as: OWNER, ifMatch: review.sessionRevision, body: { ratings } })
      expect((await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
      return (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    }
    const setup = await setupThreeProviders()
    const geminiKey = setup.draft.configurations[2].key
    // The default fake answers `gemini-3.6-flash-001`: a stable version of the model asked for, so no note.
    const first = (await start(setup)).json.data.runId as string
    await h.drainJobs()
    const plain = await unseal(first)
    for (const testCase of plain.cases) for (const response of testCase.responses) expect(response.modelNote).toBeNull()

    h.setProvider(async (call) => {
      if (!call.url.includes('googleapis')) return okStub(call, new AbortController().signal)
      const body = await googleOk().json()
      return new Response(JSON.stringify({ ...body, modelVersion: 'gemini-3.6-flash-lite' }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    // A new day, so the daily call cap does not refuse the second hearing.
    h.advance(24 * 60 * 60 * 1000)
    const again = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
      as: OWNER,
      body: { draftRevision: setup.revision, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId, google: setup.googleKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(again.status, JSON.stringify(again.json)).toBe(202)
    await h.drainJobs()
    const rerouted = await unseal(again.json.data.runId as string)
    for (const testCase of rerouted.cases) {
      for (const response of testCase.responses) {
        if (response.configurationKey === geminiKey) expect(response.modelNote).toBe('Google reported that gemini-3.6-flash-lite answered, not gemini-3.6-flash, the model this hearing asked for.')
        else expect(response.modelNote).toBeNull()
      }
    }
  })
})

describe('the special master on a Gemini route', () => {
  it('grades with the Google key on the Google endpoint', async () => {
    const setup = await setupOwner(h)
    const googleKey = (await saveGoogleKey()).json.data.id as string
    const runId = (await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, { as: OWNER, body: { draftRevision: 1, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true } })).json.data.runId as string
    await h.drainJobs()
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
    const saved = await h.request('PUT', `/runs/${runId}/review`, { as: OWNER, ifMatch: review.sessionRevision, body: { ratings } })
    expect((await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
    const grade: ProviderStub = async (call, signal) => (call.url.includes('googleapis') ? googleOk('{"correctness":2,"completeness":1,"grounding":2,"note":"Fine."}') : okStub(call, signal))
    h.setProvider(grade)
    const before = h.providerCalls.length
    const started = await h.request('POST', `/runs/${runId}/special-master`, { as: OWNER, body: { modelKey: GEMINI, credentialIdsByProvider: { google: googleKey }, consentToProviderProcessing: true, acknowledgeProviderCharges: true } })
    expect(started.status, JSON.stringify(started.json)).toBe(202)
    await h.drainJobs()
    const calls = h.providerCalls.slice(before)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.url.startsWith('https://generativelanguage.googleapis.com/') && call.headers['x-goog-api-key'] === GOOGLE_KEY)).toBe(true)
    const master = (await h.request('GET', `/runs/${runId}/special-master`, { as: OWNER })).json.data
    expect(JSON.stringify(master)).toContain('succeeded')
    void openAiOk
    void anthropicOk
  })
})

describe('the outbound allowlist', () => {
  it('a route whose transport would leave the allowlist records PROVIDER_REJECTED_REQUEST and gives its unit back', async () => {
    // A fake registry URL: a model ID that is not registry-shaped never builds a request.
    await h.dispose()
    const { MODEL_ROUTES } = await import('../../src/domain/registry')
    h = await createHarness({ routes: MODEL_ROUTES.map((route) => ({ ...route, verifiedAt: '2026-11-16', multiTurnVerifiedAt: '2026-11-16', ...(route.key === GEMINI ? { modelId: 'evil.test/../x' } : {}) })) })
    const setup = await setupThreeProviders()
    const runId = (await start(setup)).json.data.runId as string
    await h.drainJobs()
    expect(googleCalls()).toEqual([])
    const attempts = await h.db.prepare(`SELECT a.error_code, a.status, a.unsent FROM generation_attempts a JOIN generations g ON g.id = a.generation_id WHERE g.run_id = ? AND g.provider = 'google'`).bind(runId).all()
    expect(attempts.results.length).toBeGreaterThan(0)
    // D-113: marked unsent, so setup metrics do not count it as a provider call.
    expect(attempts.results.every((a) => a.error_code === 'PROVIDER_REJECTED_REQUEST' && a.status === 'failed' && a.unsent === 1)).toBe(true)
    const sent = await h.db.prepare(`SELECT a.unsent FROM generation_attempts a JOIN generations g ON g.id = a.generation_id WHERE g.run_id = ? AND g.provider <> 'google'`).bind(runId).all()
    expect(sent.results.length).toBeGreaterThan(0)
    expect(sent.results.every((a) => a.unsent === 0)).toBe(true)
    const reservations = await h.db.prepare(`SELECT r.state FROM attempt_reservations r JOIN generations g ON g.id = r.generation_id WHERE g.run_id = ? AND g.provider = 'google'`).bind(runId).all()
    expect(reservations.results.every((r) => r.state === 'released')).toBe(true)
    void REVIEWER
  })
})
