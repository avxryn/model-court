/**
 * Spec 07 §6.3, §11.1 (D-108): the Gemini adapter versions. Request bodies are pinned; responses and
 * errors are mapped from fixed fields only, and provider text never reaches an outcome.
 */

import { describe, expect, it } from 'vitest'
import { LIMITS } from '../../domain/limits'
import { ADAPTER_PROFILES, adapterVersionFor, MODEL_ROUTES } from '../../domain/registry'
import type { ProviderRequest } from './common'
import { googleFailure, googleGenerateUrl, googleRequestBody, makeGoogleAdapter } from './google'
import { adapterFor } from './index'

const never = new AbortController().signal
const KEY = 'AIzaSENTINEL-GOOGLE-KEY'
const SECRET = 'PROVIDER-SECRET-MESSAGE'

function request(extra: Partial<ProviderRequest> = {}): ProviderRequest {
  return { modelId: 'gemini-3.6-flash', system: 'Be brief.', messages: [{ role: 'user', content: 'Hello?' }], maxOutputTokens: LIMITS.maxOutputTokens, apiKey: KEY, signal: never, ...extra }
}

function capture(reply: unknown, status = 200, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status, headers })
  }) as typeof fetch
  return { calls, fetchFn }
}

const ok = (extra: Record<string, unknown> = {}, candidate: Record<string, unknown> = {}) => ({
  candidates: [{ content: { role: 'model', parts: [{ text: 'Hi.' }] }, finishReason: 'STOP', ...candidate }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, thoughtsTokenCount: 40, totalTokenCount: 55 },
  modelVersion: 'gemini-3.6-flash-001',
  responseId: 'resp-abc',
  ...extra,
})

async function run(reply: unknown, status = 200, thinking: 'low' | 'minimal' | 'budget-off' = 'minimal', extra: Partial<ProviderRequest> = {}) {
  const { calls, fetchFn } = capture(reply, status)
  const outcome = await makeGoogleAdapter(thinking)(fetchFn, request(extra), never)
  return { outcome, calls }
}

describe('Gemini request bodies (golden)', () => {
  it('low: thinkingLevel and the reasoning headroom, store off, nothing else', () => {
    expect(googleRequestBody('S', [{ role: 'user', content: 'U' }], 512, 'low')).toEqual({
      systemInstruction: { parts: [{ text: 'S' }] },
      contents: [{ role: 'user', parts: [{ text: 'U' }] }],
      generationConfig: { maxOutputTokens: 512 + LIMITS.reasoningHeadroomTokens, thinkingConfig: { thinkingLevel: 'low' } },
      store: false,
    })
  })

  it('minimal keeps the headroom; budget-off sends thinkingBudget 0 and the bare cap; never both fields', () => {
    expect(googleRequestBody('S', [{ role: 'user', content: 'U' }], 512, 'minimal').generationConfig).toEqual({ maxOutputTokens: 8_704, thinkingConfig: { thinkingLevel: 'minimal' } })
    expect(googleRequestBody('S', [{ role: 'user', content: 'U' }], 512, 'budget-off').generationConfig).toEqual({ maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } })
    for (const thinking of ['low', 'minimal', 'budget-off'] as const) {
      const config = googleRequestBody('S', [{ role: 'user', content: 'U' }], 512, thinking).generationConfig.thinkingConfig
      expect(Object.keys(config)).toHaveLength(1)
    }
  })

  it('multi-turn: assistant turns become model turns, in order', () => {
    const body = googleRequestBody(
      'S',
      [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
      512,
      'low',
    )
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'model', parts: [{ text: 'b' }] },
      { role: 'user', parts: [{ text: 'c' }] },
    ])
  })

  it('sends no temperature, tools, safety settings, cached content or thoughts request', async () => {
    const { calls } = await run(ok())
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['contents', 'generationConfig', 'store', 'systemInstruction'])
    expect(body.store).toBe(false)
    const text = String(calls[0].init.body)
    for (const field of ['temperature', 'tools', 'toolConfig', 'safetySettings', 'cachedContent', 'includeThoughts', 'responseMimeType', 'responseJsonSchema', 'functionDeclarations']) expect(text).not.toContain(field)
  })
})

describe('Gemini URL and headers', () => {
  it('POSTs to the fixed generateContent URL built from the registry ID, key in x-goog-api-key only', async () => {
    const { calls } = await run(ok())
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.redirect).toBe('manual')
    expect(calls[0].init.headers).toEqual({ 'content-type': 'application/json', 'x-goog-api-key': KEY })
    expect(calls[0].url).not.toMatch(/key=/i)
    expect(calls[0].url).not.toContain(KEY)
    expect(String(calls[0].init.body)).not.toContain(KEY)
  })

  it('no registry route builds a URL with a key, a query or an unexpected path', () => {
    for (const route of MODEL_ROUTES.filter((r) => r.provider === 'google')) {
      const url = new URL(googleGenerateUrl(route.modelId))
      expect(url.origin).toBe('https://generativelanguage.googleapis.com')
      expect(url.search).toBe('')
      expect(url.pathname).toBe(`/v1beta/models/${route.modelId}:generateContent`)
    }
  })

  it('refuses, unsent, a model ID that is not a registry-shaped ID', async () => {
    for (const modelId of ['../x', 'Gemini', 'a/b', 'a?key=1', 'm:generateContent', '']) {
      const { outcome, calls } = await run(ok(), 200, 'low', { modelId })
      expect(outcome).toMatchObject({ kind: 'failure', code: 'PROVIDER_REJECTED_REQUEST', definite: true, unsent: true })
      expect(calls).toHaveLength(0)
    }
  })
})

describe('Gemini responses', () => {
  it('joins text parts and ignores thought parts and thought signatures', async () => {
    const { outcome } = await run(ok({}, { content: { parts: [{ text: 'secret thinking', thought: true }, { text: 'Hello ', thoughtSignature: 'sig' }, { text: 'there.' }, { functionCall: { name: 'x' } }] } }))
    expect(outcome).toMatchObject({ kind: 'success', text: 'Hello there.' })
  })

  it('sums candidates and thoughts as billed output, keeps cached input and thoughts as reasoning, and records the model and response IDs', async () => {
    const { outcome } = await run(ok({ usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, thoughtsTokenCount: 40, cachedContentTokenCount: 8 } }))
    expect(outcome).toEqual({
      kind: 'success',
      text: 'Hi.',
      finishReason: 'STOP',
      inputTokens: 12,
      outputTokens: 43,
      cachedInputTokens: 8,
      reasoningTokens: 40,
      providerRequestId: 'resp-abc',
      observedModel: 'gemini-3.6-flash-001',
      durationMs: expect.any(Number),
      truncated: false,
    })
  })

  it('reads missing usage as null, never 0', async () => {
    const { outcome } = await run(ok({ usageMetadata: { promptTokenCount: 5 }, responseId: undefined, modelVersion: undefined }))
    expect(outcome).toMatchObject({ kind: 'success', inputTokens: 5, outputTokens: null, reasoningTokens: null, cachedInputTokens: null, providerRequestId: null, observedModel: null })
    const noThoughts = await run(ok({ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }))
    expect(noThoughts.outcome).toMatchObject({ outputTokens: 2, reasoningTokens: null })
  })

  it('MAX_TOKENS marks the answer cut off', async () => {
    const { outcome } = await run(ok({}, { finishReason: 'MAX_TOKENS' }))
    expect(outcome).toMatchObject({ kind: 'success', truncated: true, finishReason: 'MAX_TOKENS' })
  })

  it('a prompt block with no candidates is PROVIDER_BLOCKED; no candidates otherwise is an invalid response', async () => {
    expect((await run({ promptFeedback: { blockReason: 'SAFETY' } })).outcome).toMatchObject({ kind: 'failure', code: 'PROVIDER_BLOCKED', definite: true })
    expect((await run({ candidates: [] })).outcome).toMatchObject({ kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true })
    expect((await run('not json')).outcome).toMatchObject({ kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE' })
  })

  it('a filter stop without text is PROVIDER_BLOCKED; with some text it is kept and marked cut off', async () => {
    for (const reason of ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'LANGUAGE']) {
      expect((await run(ok({}, { finishReason: reason, content: { parts: [] } }))).outcome, reason).toMatchObject({ kind: 'failure', code: 'PROVIDER_BLOCKED', definite: true })
      expect((await run(ok({}, { finishReason: reason }))).outcome, reason).toMatchObject({ kind: 'success', text: 'Hi.', truncated: true, finishReason: reason })
    }
  })

  it('MALFORMED_RESPONSE, OTHER or an unspecified finish with no text is EMPTY_OUTPUT', async () => {
    for (const reason of ['MALFORMED_RESPONSE', 'OTHER', 'FINISH_REASON_UNSPECIFIED']) {
      expect((await run(ok({}, { finishReason: reason, content: { parts: [{ text: '  ' }] } }))).outcome, reason).toMatchObject({ kind: 'failure', code: 'EMPTY_OUTPUT', definite: true })
    }
  })

  it('a thinking-only answer (no text) is EMPTY_OUTPUT', async () => {
    expect((await run(ok({}, { finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'thoughts', thought: true }] } }))).outcome).toMatchObject({ kind: 'failure', code: 'EMPTY_OUTPUT' })
  })
})

describe('Gemini errors', () => {
  const legacy = (code: number, status: string, reason?: string) => ({ error: { code, message: SECRET, status, ...(reason ? { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }] } : {}) } })
  const newer = (code: string) => ({ error: { code, message: SECRET } })
  const cases: Array<[number, unknown, string, boolean]> = [
    [400, legacy(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID'), 'PROVIDER_AUTH_FAILED', true],
    [400, legacy(400, 'INVALID_ARGUMENT', 'API_KEY_EXPIRED'), 'PROVIDER_AUTH_FAILED', true],
    [401, newer('authentication'), 'PROVIDER_AUTH_FAILED', true],
    [402, newer('payment_required'), 'PROVIDER_QUOTA_EXHAUSTED', true],
    [403, legacy(403, 'PERMISSION_DENIED'), 'PROVIDER_ACCESS_DENIED', true],
    [400, legacy(400, 'FAILED_PRECONDITION'), 'PROVIDER_ACCESS_DENIED', true],
    [404, legacy(404, 'NOT_FOUND'), 'PROVIDER_MODEL_UNAVAILABLE', true],
    [400, newer('model_not_found'), 'PROVIDER_MODEL_UNAVAILABLE', true],
    [429, newer('quota_exceeded'), 'PROVIDER_QUOTA_EXHAUSTED', true],
    [429, legacy(429, 'RESOURCE_EXHAUSTED'), 'PROVIDER_RATE_LIMITED', true],
    [429, newer('rate_limit_exceeded'), 'PROVIDER_RATE_LIMITED', true],
    [500, legacy(500, 'INTERNAL'), 'PROVIDER_UNAVAILABLE', true],
    [503, legacy(503, 'UNAVAILABLE'), 'PROVIDER_UNAVAILABLE', true],
    [504, legacy(504, 'DEADLINE_EXCEEDED'), 'PROVIDER_UNAVAILABLE', false],
    [499, legacy(499, 'CANCELLED'), 'PROVIDER_UNAVAILABLE', false],
    [400, legacy(400, 'INVALID_ARGUMENT'), 'PROVIDER_REJECTED_REQUEST', true],
    [422, 'not json', 'PROVIDER_REJECTED_REQUEST', true],
  ]

  it('maps both error shapes from fixed fields; 504 and 499 may have been billed', async () => {
    for (const [status, body, code, definite] of cases) {
      const { outcome } = await run(body, status)
      expect(outcome, `${status} ${JSON.stringify(body)}`).toMatchObject({ kind: 'failure', code, definite })
      expect(JSON.stringify(outcome)).not.toContain(SECRET)
    }
  })

  it('googleFailure never looks at the message', () => {
    expect(googleFailure(400, { error: { message: 'API_KEY_INVALID' } })).toEqual({ code: 'PROVIDER_REJECTED_REQUEST', definite: true })
  })

  it('refuses a redirect and keeps the key off the new location; caps the body', async () => {
    const { fetchFn, calls } = capture('', 302, { location: 'https://evil.test/' })
    expect(await makeGoogleAdapter('low')(fetchFn, request(), never)).toMatchObject({ kind: 'failure', code: 'PROVIDER_REDIRECT_REFUSED', definite: true })
    expect(calls).toHaveLength(1)
    const big = capture('x'.repeat(LIMITS.providerResponseBodyBytes + 1))
    expect(await makeGoogleAdapter('low')(big.fetchFn, request(), never)).toMatchObject({ kind: 'failure', code: 'OUTPUT_TOO_LARGE' })
  })
})

describe('Gemini versions in the registry and dispatch', () => {
  it('every google-* version maps to a transport for Google keys only, and to no other provider', async () => {
    for (const version of ['google-generate-low-v1', 'google-generate-minimal-v1', 'google-generate-budget-off-v1']) {
      expect(ADAPTER_PROFILES[version as keyof typeof ADAPTER_PROFILES].provider).toBe('google')
      expect(adapterFor(version, 'google', 3)).not.toBeNull()
      expect(adapterFor(version, 'openai', 1)).toBeNull()
      expect(adapterFor(version, 'anthropic', 1)).toBeNull()
    }
    expect(adapterFor('openai-responses-v2', 'google', 1)).toBeNull()
    expect(adapterFor('anthropic-messages-v2', 'google', 1)).toBeNull()
  })

  it('carries no structured output, PDF or tool loop, so feature kits find no version for Gemini', () => {
    for (const version of ['google-generate-low-v1', 'google-generate-minimal-v1', 'google-generate-budget-off-v1']) {
      expect(adapterFor(version, 'google', 1, { structuredOutput: true })).toBeNull()
      expect(adapterFor(version, 'google', 1, { pdfInput: true })).toBeNull()
      expect(adapterVersionFor(version, { structuredOutput: true, pdfInput: true })).toBeNull()
      expect(adapterVersionFor(version, { toolUse: true })).toBeNull()
      expect(adapterVersionFor(version, {})).toBe(version)
    }
  })

  it('the dispatched transport sends Google keys only to Google', async () => {
    const adapter = adapterFor('google-generate-minimal-v1', 'google', 1)!
    const { calls, fetchFn } = capture(ok())
    expect((await adapter(fetchFn, request(), never)).kind).toBe('success')
    expect(new URL(calls[0].url).origin).toBe('https://generativelanguage.googleapis.com')
  })
})
