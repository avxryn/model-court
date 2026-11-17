import { describe, expect, it } from 'vitest'
import { anthropicRequestBody } from './anthropic'
import { adapterFor } from './index'
import { openAiRequestBody } from './openai'

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
