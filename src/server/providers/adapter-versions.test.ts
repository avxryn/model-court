import { describe, expect, it } from 'vitest'
import { LIMITS } from '../../domain/limits'
import { ADAPTER_PROFILES, ADAPTER_VERSIONS, MODEL_ROUTES, PROVIDERS } from '../../domain/registry'
import { ANTHROPIC_MESSAGES_URL, anthropicRequestBody, makeAnthropicAdapter } from './anthropic'
import type { ProviderRequest } from './common'
import { ADAPTERS, adapterFor } from './index'
import { makeOpenAiAdapter, OPENAI_RESPONSES_URL, openAiRequestBody } from './openai'

const one = [{ role: 'user' as const, content: 'u' }]
const never = new AbortController().signal
const request = (modelId: string): ProviderRequest => ({ modelId, system: 's', messages: one, maxOutputTokens: LIMITS.maxOutputTokens, apiKey: 'test-key', signal: never })

/** Records what an adapter would send, then answers with the given provider body. */
function capture(reply: unknown) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) })
    return new Response(JSON.stringify(reply), { status: 200 })
  }) as unknown as typeof fetch
  return { sent, fetchFn }
}

const openAiReply = { status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: 'answer' }] }], usage: { input_tokens: 3, output_tokens: 40 } }
const anthropicReply = { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'answer' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 40 } }

describe('ADAPTERS keyed by adapter version (D-48)', () => {
  it('has exactly one entry per registry version, for that version’s provider', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual([...ADAPTER_VERSIONS].sort())
    for (const version of ADAPTER_VERSIONS) {
      expect(ADAPTERS[version].provider).toBe(ADAPTER_PROFILES[version].provider)
      expect(ADAPTERS[version].multiTurn).toBe(ADAPTER_PROFILES[version].multiTurn)
    }
  })

  it('resolves every registry route for its own provider, alone or with a conversation', () => {
    for (const route of MODEL_ROUTES) {
      expect(adapterFor(route.adapterVersion, route.provider, 1), route.key).toBeTypeOf('function')
      expect(adapterFor(route.adapterVersion, route.provider, 3), route.key).toBeTypeOf('function')
    }
  })

  it('never hands one provider’s key to another provider’s transport', () => {
    for (const version of ADAPTER_VERSIONS) {
      const other = PROVIDERS.find((provider) => provider !== ADAPTER_PROFILES[version].provider)!
      expect(adapterFor(version, other, 1), version).toBeNull()
    }
  })

  it('sends each route to its provider’s fixed endpoint with that route’s request profile', async () => {
    for (const route of MODEL_ROUTES) {
      const reply = route.provider === 'openai' ? openAiReply : anthropicReply
      const { sent, fetchFn } = capture(reply)
      const outcome = await adapterFor(route.adapterVersion, route.provider, 1)!(fetchFn, request(route.modelId), never)
      expect(outcome, route.key).toMatchObject({ kind: 'success', text: 'answer' })
      expect(sent).toHaveLength(1)
      const [{ url, headers, body }] = sent
      expect(body.model).toBe(route.modelId)
      const cap = route.reasoning === 'low' ? LIMITS.maxOutputTokens + LIMITS.reasoningHeadroomTokens : LIMITS.maxOutputTokens
      if (route.provider === 'openai') {
        expect(url).toBe(OPENAI_RESPONSES_URL)
        expect(headers.authorization).toBe('Bearer test-key')
        expect(body).toMatchObject({ max_output_tokens: cap, reasoning: { effort: route.reasoning === 'low' ? 'low' : 'none' }, store: false })
      } else {
        expect(url).toBe(ANTHROPIC_MESSAGES_URL)
        expect(headers['x-api-key']).toBe('test-key')
        expect(headers.authorization).toBeUndefined()
        expect(body.max_tokens).toBe(cap)
        expect('temperature' in body).toBe(false)
      }
    }
  })
})

describe('request bodies per version (D-48)', () => {
  it('OpenAI low effort adds the reasoning headroom and nothing else', () => {
    const none = openAiRequestBody('m', 's', one, 512)
    expect(openAiRequestBody('m', 's', one, 512, 'low')).toEqual({ ...none, max_output_tokens: 512 + LIMITS.reasoningHeadroomTokens, reasoning: { effort: 'low' } })
  })

  it('Anthropic: disabled is unchanged; between_tools sends only that type; adaptive-low asks for low effort with headroom', () => {
    const disabled = anthropicRequestBody('m', 's', one, 512)
    expect(disabled.thinking).toEqual({ type: 'disabled' })
    expect(anthropicRequestBody('m', 's', one, 512, 'between_tools')).toEqual({ ...disabled, thinking: { type: 'between_tools' } })
    expect(anthropicRequestBody('m', 's', one, 512, 'adaptive-low')).toEqual({
      ...disabled,
      max_tokens: 512 + LIMITS.reasoningHeadroomTokens,
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: 'low' },
    })
  })

  it('reads only visible text when thinking or reasoning used the budget', async () => {
    const empty = { content: [{ type: 'thinking', thinking: '', signature: 'sig' }], stop_reason: 'max_tokens' }
    expect(await makeAnthropicAdapter('adaptive-low')(capture(empty).fetchFn, request('m'), never)).toMatchObject({ kind: 'failure', code: 'EMPTY_OUTPUT' })
    const incomplete = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning', summary: [] }] }
    expect(await makeOpenAiAdapter('low')(capture(incomplete).fetchFn, request('m'), never)).toMatchObject({ kind: 'failure', code: 'EMPTY_OUTPUT' })
  })
})
