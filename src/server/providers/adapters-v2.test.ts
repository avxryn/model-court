import { describe, expect, it } from 'vitest'
import { anthropicAdapter, anthropicRequestBody } from './anthropic'
import type { ProviderRequest } from './common'
import { adapterFor } from './index'
import { openAiAdapter, openAiRequestBody } from './openai'

const conversation = [
  { role: 'user' as const, content: 'first' },
  { role: 'assistant' as const, content: 'reply' },
  { role: 'user' as const, content: 'next' },
]

describe('v2 request bodies (D-39)', () => {
  it('a single user message produces exactly the v1 bodies', () => {
    expect(openAiRequestBody('m', 's', [{ role: 'user', content: 'u' }], 512)).toEqual({
      model: 'm',
      instructions: 's',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'u' }] }],
      max_output_tokens: 512,
      reasoning: { effort: 'none' },
      store: false,
    })
    expect(anthropicRequestBody('m', 's', [{ role: 'user', content: 'u' }], 512)).toEqual({
      model: 'm',
      max_tokens: 512,
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      thinking: { type: 'disabled' },
    })
  })

  it('sends earlier turns in order with each provider’s assistant shape', () => {
    expect(openAiRequestBody('m', 's', conversation, 512).input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'first' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'reply' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'next' }] },
    ])
    expect(anthropicRequestBody('m', 's', conversation, 512).messages).toEqual(conversation)
  })
})

describe('dispatch by recorded adapter version', () => {
  it('v1 versions carry only a single message; v2 versions carry a conversation; unknown versions are refused', () => {
    expect(adapterFor('openai-responses-v1', 'openai', 1)).toBeTypeOf('function')
    expect(adapterFor('openai-responses-v1', 'openai', 3)).toBeNull()
    expect(adapterFor('anthropic-messages-v1', 'anthropic', 3)).toBeNull()
    expect(adapterFor('openai-responses-v2', 'openai', 3)).toBeTypeOf('function')
    expect(adapterFor('anthropic-messages-v2', 'anthropic', 3)).toBeTypeOf('function')
    expect(adapterFor('made-up-v9', 'openai', 1)).toBeNull()
  })
})

describe('usage details (D-64)', () => {
  const request = (): ProviderRequest => ({ modelId: 'm', system: 's', messages: [{ role: 'user', content: 'u' }], maxOutputTokens: 512, apiKey: 'k', signal: new AbortController().signal })
  const never = new AbortController().signal
  const respond = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
  const openAiBody = (usage: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage })
  const anthropicBody = (usage: unknown) => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage })

  it('reads OpenAI cached and reasoning tokens from the usage details', async () => {
    const outcome = await openAiAdapter(respond(openAiBody({ input_tokens: 1200, output_tokens: 300, input_tokens_details: { cached_tokens: 1024 }, output_tokens_details: { reasoning_tokens: 256 } })), request(), never)
    expect(outcome).toMatchObject({ kind: 'success', inputTokens: 1200, outputTokens: 300, cachedInputTokens: 1024, reasoningTokens: 256 })
  })

  it('reads Anthropic cache reads and thinking tokens', async () => {
    const outcome = await anthropicAdapter(respond(anthropicBody({ input_tokens: 25, output_tokens: 348, cache_read_input_tokens: 500, cache_creation_input_tokens: 0, output_tokens_details: { thinking_tokens: 312 } })), request(), never)
    expect(outcome).toMatchObject({ kind: 'success', inputTokens: 25, outputTokens: 348, cachedInputTokens: 500, reasoningTokens: 312 })
  })

  it('keeps missing or malformed details null, never zero', async () => {
    for (const usage of [{ input_tokens: 5, output_tokens: 5 }, { input_tokens: 5, output_tokens: 5, input_tokens_details: { cached_tokens: 1.5 }, output_tokens_details: { reasoning_tokens: -1 } }, { input_tokens: 5, output_tokens: 5, input_tokens_details: 'x', output_tokens_details: null }]) {
      expect(await openAiAdapter(respond(openAiBody(usage)), request(), never)).toMatchObject({ cachedInputTokens: null, reasoningTokens: null })
    }
    for (const usage of [{ input_tokens: 5, output_tokens: 5 }, { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: '9', output_tokens_details: { thinking_tokens: 'many' } }]) {
      expect(await anthropicAdapter(respond(anthropicBody(usage)), request(), never)).toMatchObject({ cachedInputTokens: null, reasoningTokens: null })
    }
  })
})
