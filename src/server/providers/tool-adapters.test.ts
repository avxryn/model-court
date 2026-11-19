import { describe, expect, it } from 'vitest'
import { makeExampleDraft } from '../../domain/example'
import { LIMITS } from '../../domain/limits'
import { buildToolPrompt } from '../../domain/messages'
import { ADAPTER_PROFILES, ADAPTER_VERSIONS, adapterVersionFor, MODEL_ROUTES, PROVIDERS, TOOL_SUCCESSOR, type AdapterVersion } from '../../domain/registry'
import { buildSnapshot } from '../../domain/snapshot'
import { EXAMPLE_TOOL_TASK, promptToolsOf } from '../../domain/tools/task'
import { ANTHROPIC_MESSAGES_URL } from './anthropic'
import { adapterFor } from './index'
import { OPENAI_RESPONSES_URL } from './openai'
import { anthropicToolRequestBody, openAiToolRequestBody, parseAnthropicToolStep, parseOpenAiToolStep, toolAdapterFor, type StepReplay, type ToolStepRequest } from './tools'

const never = new AbortController().signal
const TOOL_VERSIONS = ADAPTER_VERSIONS.filter((version) => ADAPTER_PROFILES[version].toolUse)
const tools = promptToolsOf(EXAMPLE_TOOL_TASK)

function capture(reply: unknown, status = 200) {
  const sent: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    sent.push({ url, init, body: JSON.parse(init.body as string) })
    return new Response(JSON.stringify(reply), { status })
  }) as unknown as typeof fetch
  return { sent, fetchFn }
}

const openAiReplay: StepReplay = {
  provider: 'openai',
  items: [
    { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'gAAA' },
    { id: 'fc_1', type: 'function_call', call_id: 'call_a', name: 'lookup_order', arguments: '{"order_id":"A-1042"}', status: 'completed' },
  ],
  callIds: ['call_a'],
}
const anthropicReplay: StepReplay = {
  provider: 'anthropic',
  items: [
    { type: 'thinking', thinking: '', signature: 'sig-1' },
    { type: 'redacted_thinking', data: 'opaque' },
    { type: 'text', text: 'Let me look.' },
    { type: 'tool_use', id: 'toolu_a', name: 'lookup_order', input: { order_id: 'A-1042' } },
    { type: 'tool_use', id: 'toolu_b', name: 'refund_shipping', input: { order_id: 'A-1042' } },
  ],
  callIds: ['toolu_a', 'toolu_b'],
}

function stepRequest(history: ToolStepRequest['history'] = []): Omit<ToolStepRequest, 'apiKey' | 'signal'> {
  return { modelId: 'm', system: 's', user: 'u', tools, history, maxOutputTokens: LIMITS.maxOutputTokens }
}

describe('tool-loop adapter versions (spec 06 §6.1)', () => {
  it('each plain route version has a tool-loop successor with the same profile plus toolUse', () => {
    expect(Object.values(TOOL_SUCCESSOR).sort()).toEqual([...TOOL_VERSIONS].sort())
    for (const [old, next] of Object.entries(TOOL_SUCCESSOR) as Array<[AdapterVersion, AdapterVersion]>) {
      expect(ADAPTER_PROFILES[next]).toEqual({ ...ADAPTER_PROFILES[old], toolUse: true })
    }
    for (const route of MODEL_ROUTES) expect(adapterVersionFor(route.adapterVersion, { toolUse: true }), route.key).toBe(TOOL_SUCCESSOR[route.adapterVersion as AdapterVersion])
    expect(adapterVersionFor('openai-responses-tool-loop-v1', {})).toBeNull()
    expect(adapterVersionFor('openai-responses-v1', { toolUse: true })).toBeNull()
  })

  it('a tool hearing records the tool-loop version; other hearings keep theirs', () => {
    const example = makeExampleDraft(() => crypto.randomUUID(), ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
    const testCase = { ...example.cases[0], reference: '', kitFields: { kind: 'tools' as const, ...EXAMPLE_TOOL_TASK } }
    const snap = buildSnapshot({ ...example, schemaVersion: 1, kit: { version: 'tools-v1', settings: {} }, cases: [testCase] } as never, MODEL_ROUTES, 't', 0)
    expect(snap.configurations.map((c) => ('adapterVersion' in c ? c.adapterVersion : null))).toEqual(['openai-responses-tool-loop-v1', 'anthropic-messages-tool-loop-v1'])
    const plain = buildSnapshot({ ...example, schemaVersion: 1 } as never, MODEL_ROUTES, 't', 0)
    expect(plain.configurations.map((c) => ('adapterVersion' in c ? c.adapterVersion : null))).toEqual(['openai-responses-v2', 'anthropic-messages-v2'])
  })

  it('tool versions have no single-call transport, and only they have a tool transport', () => {
    for (const version of ADAPTER_VERSIONS) {
      const { provider, toolUse } = ADAPTER_PROFILES[version]
      const other = PROVIDERS.find((candidate) => candidate !== provider)!
      expect(toolAdapterFor(version, provider) !== null, version).toBe(toolUse)
      expect(toolAdapterFor(version, other), version).toBeNull()
      if (toolUse) expect(adapterFor(version, provider, 1)).toBeNull()
    }
    expect(toolAdapterFor('nope', 'openai')).toBeNull()
  })
})

describe('OpenAI tool bodies (spec 06 §6.2)', () => {
  it('step 1: the plain fields plus tools, auto choice and parallel calls', () => {
    expect(openAiToolRequestBody(stepRequest(), 'none')).toEqual({
      model: 'm',
      instructions: 's',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'u' }] }],
      tools: tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
      tool_choice: 'auto',
      parallel_tool_calls: true,
      max_output_tokens: 512,
      reasoning: { effort: 'none' },
      store: false,
    })
  })

  it('step 3: earlier output items verbatim and in order, each call followed by its output', () => {
    const second: StepReplay = { provider: 'openai', items: [{ id: 'msg_2', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'One more.' }] }, { id: 'fc_2', type: 'function_call', call_id: 'call_b', name: 'refund_shipping', arguments: '{}' }], callIds: ['call_b'] }
    const body = openAiToolRequestBody(stepRequest([{ replay: openAiReplay, results: [{ output: 'R1', isError: false }] }, { replay: second, results: [{ output: 'E2', isError: true }] }]), 'low')
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'u' }] },
      ...openAiReplay.items,
      { type: 'function_call_output', call_id: 'call_a', output: 'R1' },
      ...second.items,
      { type: 'function_call_output', call_id: 'call_b', output: 'E2' },
    ])
    expect(body.max_output_tokens).toBe(512 + LIMITS.reasoningHeadroomTokens)
    expect(body.include).toEqual(['reasoning.encrypted_content'])
    expect(JSON.stringify(body.tools)).toBe(JSON.stringify(openAiToolRequestBody(stepRequest(), 'low').tools))
  })
})

describe('Anthropic tool bodies (spec 06 §6.2)', () => {
  it('step 1 per thinking profile, with headroom for between_tools on tool steps', () => {
    const disabled = anthropicToolRequestBody(stepRequest(), 'disabled')
    expect(disabled).toEqual({
      model: 'm',
      max_tokens: 512,
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
      tool_choice: { type: 'auto' },
      thinking: { type: 'disabled' },
    })
    expect(anthropicToolRequestBody(stepRequest(), 'between_tools')).toMatchObject({ max_tokens: 512 + LIMITS.reasoningHeadroomTokens, thinking: { type: 'between_tools' } })
    expect(anthropicToolRequestBody(stepRequest(), 'adaptive-low')).toMatchObject({ max_tokens: 512 + LIMITS.reasoningHeadroomTokens, thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'low' } })
  })

  it('replays content unmodified, then one tool_result per call, in order, with is_error', () => {
    const body = anthropicToolRequestBody(stepRequest([{ replay: anthropicReplay, results: [{ output: 'R1', isError: false }, { output: 'E2', isError: true }] }]), 'adaptive-low')
    expect(body.messages).toEqual([
      { role: 'user', content: 'u' },
      { role: 'assistant', content: anthropicReplay.items },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'R1', is_error: false }, { type: 'tool_result', tool_use_id: 'toolu_b', content: 'E2', is_error: true }] },
    ])
    expect(JSON.stringify([body.system, body.tools])).toBe(JSON.stringify([anthropicToolRequestBody(stepRequest(), 'adaptive-low').system, anthropicToolRequestBody(stepRequest(), 'adaptive-low').tools]))
  })
})

describe('what a step sends (spec 06 §10.3, §10.4)', () => {
  it('only to the two fixed URLs, redirects refused, the key only in its header, and no expectation or canned row', async () => {
    const testCase = { key: 'k', reference: '', input: 'Where is A-1042?', expectedBehavior: 'SENTINEL-JURY', kitFields: { kind: 'tools' as const, ...EXAMPLE_TOOL_TASK, expect: { ...EXAMPLE_TOOL_TASK.expect, finalAnswer: { mode: 'exact' as const, value: 'SENTINEL-ANSWER' } } } }
    const prompt = buildToolPrompt({ messageTemplateVersion: 'tools-v1', kit: { version: 'tools-v1', settings: {} } }, 'sys', testCase)!
    for (const version of TOOL_VERSIONS) {
      const provider = ADAPTER_PROFILES[version].provider
      const reply = provider === 'openai' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }] } : { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }
      const { sent, fetchFn } = capture(reply)
      const outcome = await toolAdapterFor(version, provider)!(fetchFn, { modelId: 'm', ...prompt, history: [], maxOutputTokens: 512, apiKey: 'test-key-123', signal: never }, never)
      expect(outcome).toMatchObject({ kind: 'success', text: 'Done.', stop: 'answer', calls: [] })
      expect(sent[0].url).toBe(provider === 'openai' ? OPENAI_RESPONSES_URL : ANTHROPIC_MESSAGES_URL)
      expect(sent[0].init.redirect).toBe('manual')
      const body = JSON.stringify(sent[0].body)
      expect(body).not.toContain('test-key-123')
      for (const hidden of ['SENTINEL', 'shipping_paid', 'No order with that ID', 'order_id is required.', 'requiredCalls']) expect(body).not.toContain(hidden)
    }
  })

  it('refuses, unsent, a request body over 512 KiB', async () => {
    const big: StepReplay = { provider: 'openai', items: [{ type: 'message', content: [{ type: 'output_text', text: 'x'.repeat(600 * 1024) }] }], callIds: [] }
    const { sent, fetchFn } = capture({})
    const outcome = await toolAdapterFor('openai-responses-tool-loop-v1', 'openai')!(fetchFn, { ...stepRequest([{ replay: big, results: [] }]), apiKey: 'k', signal: never }, never)
    expect(outcome).toMatchObject({ kind: 'failure', code: 'TOOL_TRACE_TOO_LARGE', definite: true, unsent: true })
    expect(sent).toHaveLength(0)
  })
})

const raw = (json: unknown, status = 200) => ({ status, requestId: 'req_1', json, durationMs: 5 })

describe('parsing OpenAI steps (spec 06 §6.3)', () => {
  it('parallel calls with reasoning and text, ids kept for replay only', () => {
    const body = {
      status: 'completed',
      model: 'gpt-x',
      output: [
        { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'gAAA' },
        { id: 'msg_1', type: 'message', content: [{ type: 'output_text', text: 'Checking both.' }] },
        { id: 'fc_1', type: 'function_call', call_id: 'call_a', name: 'lookup_order', arguments: '{"order_id":"A-1042"}', status: 'completed' },
        { id: 'fc_2', type: 'function_call', call_id: 'call_b', name: 'refund_shipping', arguments: '{"order_id": ', status: 'completed' },
        { id: 'fc_3', type: 'function_call', call_id: 'call_c', name: 'lookup_order', arguments: '{"order', status: 'incomplete' },
      ],
      usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 8 } },
    }
    const outcome = parseOpenAiToolStep(raw(body))
    expect(outcome).toMatchObject({ kind: 'success', text: 'Checking both.', stop: 'tool_calls', inputTokens: 100, reasoningTokens: 8, truncated: false })
    if (outcome.kind !== 'success') throw new Error('x')
    expect(outcome.calls).toEqual([
      { name: 'lookup_order', argumentsRaw: '{"order_id":"A-1042"}', argumentsParsed: { order_id: 'A-1042' } },
      { name: 'refund_shipping', argumentsRaw: '{"order_id": ', argumentsParsed: undefined },
    ])
    expect(outcome.replay.callIds).toEqual(['call_a', 'call_b'])
    expect(outcome.replay.items).toHaveLength(4)
  })

  it('truncation, refusals, empty output and protocol errors', () => {
    expect(parseOpenAiToolStep(raw({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Partial' }] }] }))).toMatchObject({ kind: 'success', truncated: true, stop: 'answer' })
    expect(parseOpenAiToolStep(raw({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I can’t help.' }] }] }))).toMatchObject({ kind: 'success', text: 'I can’t help.' })
    expect(parseOpenAiToolStep(raw({ status: 'completed', output: [] }))).toMatchObject({ kind: 'failure', code: 'EMPTY_OUTPUT', definite: true })
    expect(parseOpenAiToolStep(raw({ status: 'completed', output: [{ type: 'function_call', name: 'x', arguments: '{}' }] }))).toMatchObject({ kind: 'failure', code: 'TOOL_PROTOCOL_ERROR' })
    expect(parseOpenAiToolStep(raw({ status: 'completed', output: [{ type: 'web_search_call' }] }))).toMatchObject({ kind: 'failure', code: 'TOOL_PROTOCOL_ERROR' })
    expect(parseOpenAiToolStep(raw({ error: { code: 'insufficient_quota' } }, 429))).toMatchObject({ kind: 'failure', code: 'PROVIDER_QUOTA_EXHAUSTED' })
    expect(parseOpenAiToolStep(raw({ output: 'x' }))).toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
    const huge = { status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'g'.repeat(70 * 1024) }, { type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }
    expect(parseOpenAiToolStep(raw(huge))).toMatchObject({ code: 'TOOL_TRACE_TOO_LARGE', definite: true })
  })
})

describe('parsing Anthropic steps (spec 06 §6.3)', () => {
  it('thinking, redacted thinking and text kept for replay; calls with object input', () => {
    const outcome = parseAnthropicToolStep(raw({ model: 'claude-x', content: anthropicReplay.items, stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 0 } }))
    expect(outcome).toMatchObject({ kind: 'success', text: 'Let me look.', stop: 'tool_calls', finishReason: 'tool_use' })
    if (outcome.kind !== 'success') throw new Error('x')
    expect(outcome.calls.map((call) => [call.name, call.argumentsRaw])).toEqual([['lookup_order', '{"order_id":"A-1042"}'], ['refund_shipping', '{"order_id":"A-1042"}']])
    expect(outcome.replay).toEqual(anthropicReplay)
  })

  it('max_tokens drops a trailing call without usable input; pause_turn, server tools and refusals', () => {
    const cut = parseAnthropicToolStep(raw({ content: [{ type: 'text', text: 'Looking' }, { type: 'tool_use', id: 'toolu_x', name: 'lookup_order', input: '{"order' }], stop_reason: 'max_tokens' }))
    expect(cut).toMatchObject({ kind: 'success', truncated: true, calls: [], text: 'Looking' })
    expect(parseAnthropicToolStep(raw({ content: [{ type: 'text', text: 'x' }], stop_reason: 'pause_turn' }))).toMatchObject({ code: 'TOOL_PROTOCOL_ERROR' })
    expect(parseAnthropicToolStep(raw({ content: [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' }], stop_reason: 'tool_use' }))).toMatchObject({ code: 'TOOL_PROTOCOL_ERROR' })
    expect(parseAnthropicToolStep(raw({ content: [{ type: 'tool_use', name: 'lookup_order', input: {} }], stop_reason: 'tool_use' }))).toMatchObject({ code: 'TOOL_PROTOCOL_ERROR' })
    expect(parseAnthropicToolStep(raw({ content: [], stop_reason: 'refusal' }))).toMatchObject({ code: 'PROVIDER_BLOCKED', definite: true })
    expect(parseAnthropicToolStep(raw({ content: [{ type: 'thinking', thinking: '', signature: 's' }], stop_reason: 'end_turn' }))).toMatchObject({ code: 'EMPTY_OUTPUT' })
    expect(parseAnthropicToolStep(raw({ error: { type: 'overloaded_error' } }, 529))).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', definite: true })
  })
})
