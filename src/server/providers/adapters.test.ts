import { describe, expect, it } from 'vitest'
import { anthropicAdapter } from './anthropic'
import type { ProviderRequest } from './common'
import { openAiAdapter } from './openai'

const request = (): ProviderRequest => ({ modelId: 'm', system: 's', user: 'u', maxOutputTokens: 512, apiKey: 'k', signal: new AbortController().signal })
const never = new AbortController().signal
const respond = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })) as unknown as typeof fetch

describe('OpenAI Responses adapter (T04)', () => {
  it('keeps a length-limited answer as delivered and flags truncation', async () => {
    const outcome = await openAiAdapter(
      respond({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, model: 'gpt-x', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Partial answer' }] }], usage: { input_tokens: 5, output_tokens: 512 } }),
      request(),
      never,
    )
    expect(outcome).toMatchObject({ kind: 'success', text: 'Partial answer', truncated: true, finishReason: 'incomplete:max_output_tokens', outputTokens: 512 })
  })

  it('treats a textual refusal as gradable output and unknown usage as null, never zero', async () => {
    const outcome = await openAiAdapter(respond({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I can’t help with that.' }] }] }), request(), never)
    expect(outcome).toMatchObject({ kind: 'success', text: 'I can’t help with that.', inputTokens: null, outputTokens: null })
  })

  it('maps reasoning-only output with no text to EMPTY_OUTPUT', async () => {
    const outcome = await openAiAdapter(respond({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning', summary: [] }] }), request(), never)
    expect(outcome).toMatchObject({ kind: 'failure', code: 'EMPTY_OUTPUT', definite: true })
  })

  it('distinguishes exhausted quota from rate limiting on 429', async () => {
    expect(await openAiAdapter(respond({ error: { code: 'insufficient_quota' } }, 429), request(), never)).toMatchObject({ code: 'PROVIDER_QUOTA_EXHAUSTED' })
    expect(await openAiAdapter(respond({ error: { code: 'rate_limit_exceeded' } }, 429), request(), never)).toMatchObject({ code: 'PROVIDER_RATE_LIMITED' })
    expect(await openAiAdapter(respond({ error: { code: 'model_not_found' } }, 404), request(), never)).toMatchObject({ code: 'PROVIDER_MODEL_UNAVAILABLE' })
  })
})

describe('Anthropic Messages adapter (T04)', () => {
  it('joins text blocks, maps max_tokens to truncated, and keeps the request id', async () => {
    const outcome = await anthropicAdapter(
      respond({ model: 'claude-x', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }], stop_reason: 'max_tokens', usage: { input_tokens: 9, output_tokens: 512 } }, 200, { 'request-id': 'req_1' }),
      request(),
      never,
    )
    expect(outcome).toMatchObject({ kind: 'success', text: 'Hello there', truncated: true, providerRequestId: 'req_1', observedModel: 'claude-x' })
  })

  it('maps a refusal stop with no text to PROVIDER_BLOCKED', async () => {
    expect(await anthropicAdapter(respond({ content: [], stop_reason: 'refusal' }), request(), never)).toMatchObject({ kind: 'failure', code: 'PROVIDER_BLOCKED' })
  })

  it('maps credit balance, overload, and auth errors without exposing upstream text', async () => {
    const credit = await anthropicAdapter(respond({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the API.' } }, 400), request(), never)
    expect(credit).toEqual({ kind: 'failure', code: 'PROVIDER_QUOTA_EXHAUSTED', definite: true, providerRequestId: null, durationMs: expect.any(Number) })
    expect(await anthropicAdapter(respond({ type: 'error', error: { type: 'overloaded_error' } }, 529), request(), never)).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(await anthropicAdapter(respond({ type: 'error', error: { type: 'authentication_error' } }, 401), request(), never)).toMatchObject({ code: 'PROVIDER_AUTH_FAILED' })
  })

  it('refuses bodies over the response byte ceiling before parsing', async () => {
    const huge = JSON.stringify({ content: [{ type: 'text', text: 'x'.repeat(300 * 1024) }] })
    expect(await anthropicAdapter(respond(huge), request(), never)).toMatchObject({ code: 'OUTPUT_TOO_LARGE' })
  })

  it('reports a network failure as uncertain (possibly billed)', async () => {
    const failing = (async () => {
      throw new TypeError('connection reset')
    }) as unknown as typeof fetch
    expect(await anthropicAdapter(failing, request(), never)).toMatchObject({ kind: 'failure', code: 'PROVIDER_NETWORK_ERROR', definite: false })
  })
})
