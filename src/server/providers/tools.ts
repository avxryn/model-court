/**
 * The tool-loop protocol of both providers (spec 06 §6, D-100): one step is one non-streaming POST
 * to the same two fixed endpoints, with the tools, the user message and every earlier step's
 * provider-native content replayed verbatim in order, each followed by Model Court's mock results.
 *
 * Only the `*-tool-loop-v1` adapter versions reach this module (`toolAdapterFor`); the single-call
 * `Adapter`s and their bodies are untouched, so every recorded hearing still sends the bytes it
 * recorded. `postJson` is used unchanged: fixed URL, `redirect: 'manual'`, the response-body
 * ceiling, no retries. The key goes only into that one request's auth header.
 */

import { LIMITS } from '../../domain/limits'
import { adapterProfile, type AdapterVersion, type ProviderId } from '../../domain/registry'
import { utf8ByteLength } from '../../domain/text'
import type { ModelCall } from '../../domain/tools/mock'
import type { PromptTool } from '../../domain/tools/task'
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, type AnthropicThinking } from './anthropic'
import { classifyHttpError, isFailure, isRecord, nonNegativeInt, postJson, subRecord, type ProviderFailure } from './common'
import { OPENAI_RESPONSES_URL, type OpenAiReasoning } from './openai'

/**
 * What the next request needs from a finished step, kept server-side only (`generation_steps.replay_json`)
 * and nulled when the attempt finishes: the provider's own output items or content blocks, exactly
 * as returned (minus calls that were dropped), and the call ids in call order.
 */
export interface StepReplay {
  provider: ProviderId
  items: unknown[]
  callIds: string[]
}

export interface ToolStepRequest {
  modelId: string
  system: string
  /** The `tools-v1` user message. */
  user: string
  tools: readonly PromptTool[]
  /** Every finished step, in order, with the mock results of its calls in call order. */
  history: ReadonlyArray<{ replay: StepReplay; results: ReadonlyArray<{ output: string; isError: boolean }> }>
  maxOutputTokens: number
  apiKey: string
  signal: AbortSignal
}

export interface ToolStepSuccess {
  kind: 'success'
  /** The step's visible text ('' allowed when it made calls). */
  text: string
  calls: ModelCall[]
  stop: 'tool_calls' | 'answer'
  replay: StepReplay
  finishReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  providerRequestId: string | null
  observedModel: string | null
  durationMs: number
  truncated: boolean
}

/** `unsent`: refused before any network send (the request body was over its cap), so its unit can be released. */
export type ToolStepFailure = ProviderFailure & { unsent?: true }

export type ToolStepOutcome = ToolStepSuccess | ToolStepFailure

export type ToolAdapter = (fetchFn: typeof fetch, request: ToolStepRequest, timeoutSignal: AbortSignal) => Promise<ToolStepOutcome>

function parsedArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

/** The rules both parsers share (spec 06 §6.3 `finishToolStep`). */
function finishStep(step: Omit<ToolStepSuccess, 'kind' | 'stop'>): ToolStepOutcome {
  const base = { providerRequestId: step.providerRequestId, durationMs: step.durationMs }
  if (step.text.trim() === '' && step.calls.length === 0) return { kind: 'failure', code: 'EMPTY_OUTPUT', definite: true, ...base }
  if (utf8ByteLength(step.text) > LIMITS.providerOutputBytes) return { kind: 'failure', code: 'OUTPUT_TOO_LARGE', definite: true, ...base }
  if (utf8ByteLength(JSON.stringify(step.replay)) > LIMITS.tools.replayBytes) return { kind: 'failure', code: 'TOOL_TRACE_TOO_LARGE', definite: true, ...base }
  return { kind: 'success', ...step, stop: step.calls.length > 0 ? 'tool_calls' : 'answer' }
}

function tooLarge(body: unknown): ToolStepFailure | null {
  return utf8ByteLength(JSON.stringify(body)) > LIMITS.tools.requestBodyBytes ? { kind: 'failure', code: 'TOOL_TRACE_TOO_LARGE', definite: true, providerRequestId: null, durationMs: 0, unsent: true } : null
}

// ---------------------------------------------------------------------------
// OpenAI Responses
// ---------------------------------------------------------------------------

/**
 * `tool-protocol-v1` on the Responses API: the plain body's fields (`store: false`, reasoning,
 * `max_output_tokens`) plus function tools (`strict: false`, open question 2), `tool_choice: auto`
 * and parallel calls (open question 8). Each earlier step's output items go back as returned, in
 * order, each call followed by its `function_call_output`; the API has no error flag there, so
 * the judge's error text is sent as the output. Reasoning-low routes also ask for
 * `reasoning.encrypted_content`, which `store: false` needs to carry reasoning between steps.
 */
export function openAiToolRequestBody(request: Omit<ToolStepRequest, 'apiKey' | 'signal'>, reasoning: OpenAiReasoning) {
  return {
    model: request.modelId,
    instructions: request.system,
    input: [
      { role: 'user', content: [{ type: 'input_text', text: request.user }] },
      ...request.history.flatMap((step) => [
        ...step.replay.items,
        ...step.replay.callIds.map((callId, index) => ({ type: 'function_call_output', call_id: callId, output: step.results[index]?.output ?? '' })),
      ]),
    ],
    tools: request.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    max_output_tokens: reasoning === 'none' ? request.maxOutputTokens : request.maxOutputTokens + LIMITS.reasoningHeadroomTokens,
    reasoning: { effort: reasoning },
    store: false,
    ...(reasoning === 'low' ? { include: ['reasoning.encrypted_content'] } : {}),
  }
}

const OPENAI_ITEMS = new Set(['reasoning', 'message', 'function_call'])

/** Parse a Responses body (spec 06 §6.3). Exported for fixtures. */
export function parseOpenAiToolStep(raw: { status: number; requestId: string | null; json: unknown; durationMs: number }): ToolStepOutcome {
  const base = { providerRequestId: raw.requestId, durationMs: raw.durationMs }
  if (raw.status < 200 || raw.status >= 300) {
    const error = isRecord(raw.json) && isRecord(raw.json.error) ? raw.json.error : {}
    const code = classifyHttpError(raw.status, { quota: error.code === 'insufficient_quota' || error.type === 'insufficient_quota', modelMissing: error.code === 'model_not_found' })
    return { kind: 'failure', code, definite: true, ...base }
  }
  const body = raw.json
  if (!isRecord(body) || !Array.isArray(body.output)) return { kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, ...base }
  if (body.status === 'failed') return { kind: 'failure', code: 'PROVIDER_UNAVAILABLE', definite: true, ...base }
  const texts: string[] = []
  const refusals: string[] = []
  const calls: ModelCall[] = []
  const callIds: string[] = []
  const items: unknown[] = []
  for (const item of body.output) {
    if (!isRecord(item) || typeof item.type !== 'string' || !OPENAI_ITEMS.has(item.type)) return { kind: 'failure', code: 'TOOL_PROTOCOL_ERROR', definite: true, ...base }
    if (item.type === 'function_call') {
      // An incomplete call is dropped, and so is its item: a replayed call without an output is a 400.
      if (item.status === 'incomplete') continue
      if (typeof item.call_id !== 'string' || item.call_id === '' || typeof item.name !== 'string' || typeof item.arguments !== 'string') return { kind: 'failure', code: 'TOOL_PROTOCOL_ERROR', definite: true, ...base }
      calls.push({ name: item.name, argumentsRaw: item.arguments, argumentsParsed: parsedArguments(item.arguments) })
      callIds.push(item.call_id)
    } else if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!isRecord(part)) continue
        if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text)
        if (part.type === 'refusal' && typeof part.refusal === 'string') refusals.push(part.refusal)
      }
    }
    items.push(item)
  }
  const incompleteReason = isRecord(body.incomplete_details) && typeof body.incomplete_details.reason === 'string' ? body.incomplete_details.reason : null
  const usage = isRecord(body.usage) ? body.usage : {}
  return finishStep({
    ...base,
    text: texts.length > 0 ? texts.join('') : refusals.join(''),
    calls,
    replay: { provider: 'openai', items, callIds },
    finishReason: body.status === 'incomplete' ? `incomplete:${incompleteReason ?? 'unknown'}` : typeof body.status === 'string' ? body.status : null,
    inputTokens: nonNegativeInt(usage.input_tokens),
    outputTokens: nonNegativeInt(usage.output_tokens),
    cachedInputTokens: nonNegativeInt(subRecord(usage, 'input_tokens_details').cached_tokens),
    reasoningTokens: nonNegativeInt(subRecord(usage, 'output_tokens_details').reasoning_tokens),
    observedModel: typeof body.model === 'string' ? body.model : null,
    truncated: incompleteReason === 'max_output_tokens',
  })
}

export const makeOpenAiToolAdapter = (reasoning: OpenAiReasoning): ToolAdapter => async (fetchFn, request, timeoutSignal) => {
  const body = openAiToolRequestBody(request, reasoning)
  const refused = tooLarge(body)
  if (refused) return refused
  const raw = await postJson(fetchFn, OPENAI_RESPONSES_URL, { authorization: `Bearer ${request.apiKey}` }, body, request.signal, timeoutSignal, 'x-request-id')
  return isFailure(raw) ? raw : parseOpenAiToolStep(raw)
}

// ---------------------------------------------------------------------------
// Anthropic Messages
// ---------------------------------------------------------------------------

/**
 * `tool-protocol-v1` on the Messages API: the plain body's fields plus `tools` (`input_schema`) and
 * `tool_choice: auto`. Each earlier step's content goes back unmodified as the assistant turn
 * (thinking and redacted-thinking blocks included, as the API requires), then one user turn with
 * a `tool_result` per `tool_use`, in order and nothing before them, with `is_error` set from the
 * judge's toggle (Anthropic's documented channel; OpenAI gets the same text without a flag).
 * `system` and `tools` come from the snapshot, so they are byte-identical across steps.
 * `between_tools` keeps progress updates between tool calls, so on tool steps it gets the same
 * headroom as adaptive-low (spec 06 §6.2).
 */
export function anthropicToolRequestBody(request: Omit<ToolStepRequest, 'apiKey' | 'signal'>, thinking: AnthropicThinking) {
  const base = {
    model: request.modelId,
    max_tokens: thinking === 'disabled' ? request.maxOutputTokens : request.maxOutputTokens + LIMITS.reasoningHeadroomTokens,
    system: request.system,
    messages: [
      { role: 'user', content: request.user },
      ...request.history.flatMap((step) => [
        { role: 'assistant', content: step.replay.items },
        { role: 'user', content: step.replay.callIds.map((callId, index) => ({ type: 'tool_result', tool_use_id: callId, content: step.results[index]?.output ?? '', is_error: step.results[index]?.isError === true })) },
      ]),
    ],
    tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
    tool_choice: { type: 'auto' },
  }
  if (thinking === 'adaptive-low') return { ...base, thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'low' } }
  return { ...base, thinking: { type: thinking } }
}

const ANTHROPIC_BLOCKS = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use'])

/** Parse a Messages body (spec 06 §6.3). Exported for fixtures. */
export function parseAnthropicToolStep(raw: { status: number; requestId: string | null; json: unknown; durationMs: number }): ToolStepOutcome {
  const base = { providerRequestId: raw.requestId, durationMs: raw.durationMs }
  if (raw.status < 200 || raw.status >= 300) {
    const error = isRecord(raw.json) && isRecord(raw.json.error) ? raw.json.error : {}
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
    const code = raw.status === 529 ? 'PROVIDER_UNAVAILABLE' : classifyHttpError(raw.status, { quota: error.type === 'billing_error' || message.includes('credit balance'), modelMissing: error.type === 'not_found_error' })
    return { kind: 'failure', code, definite: true, ...base }
  }
  const body = raw.json
  if (!isRecord(body) || !Array.isArray(body.content)) return { kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, ...base }
  const stopReason = typeof body.stop_reason === 'string' ? body.stop_reason : null
  // Model Court cannot answer a paused turn or a server tool (none are offered).
  if (stopReason === 'pause_turn') return { kind: 'failure', code: 'TOOL_PROTOCOL_ERROR', definite: true, ...base }
  const truncated = stopReason === 'max_tokens'
  const texts: string[] = []
  const calls: ModelCall[] = []
  const callIds: string[] = []
  const blocks = [...body.content]
  // A trailing call cut off at the output limit has no usable input: dropped.
  const last = blocks.at(-1)
  if (truncated && isRecord(last) && last.type === 'tool_use' && !isRecord(last.input)) blocks.pop()
  for (const block of blocks) {
    if (!isRecord(block) || typeof block.type !== 'string' || !ANTHROPIC_BLOCKS.has(block.type)) return { kind: 'failure', code: 'TOOL_PROTOCOL_ERROR', definite: true, ...base }
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
    if (block.type === 'tool_use') {
      if (typeof block.id !== 'string' || block.id === '' || typeof block.name !== 'string' || !isRecord(block.input)) return { kind: 'failure', code: 'TOOL_PROTOCOL_ERROR', definite: true, ...base }
      const argumentsRaw = JSON.stringify(block.input)
      calls.push({ name: block.name, argumentsRaw, argumentsParsed: parsedArguments(argumentsRaw) })
      callIds.push(block.id)
    }
  }
  const text = texts.join('')
  if (text.trim() === '' && calls.length === 0 && stopReason === 'refusal') return { kind: 'failure', code: 'PROVIDER_BLOCKED', definite: true, ...base }
  const usage = isRecord(body.usage) ? body.usage : {}
  return finishStep({
    ...base,
    text,
    calls,
    replay: { provider: 'anthropic', items: blocks, callIds },
    finishReason: stopReason,
    inputTokens: nonNegativeInt(usage.input_tokens),
    outputTokens: nonNegativeInt(usage.output_tokens),
    cachedInputTokens: nonNegativeInt(usage.cache_read_input_tokens),
    reasoningTokens: nonNegativeInt(subRecord(usage, 'output_tokens_details').thinking_tokens),
    observedModel: typeof body.model === 'string' ? body.model : null,
    truncated,
  })
}

export const makeAnthropicToolAdapter = (thinking: AnthropicThinking): ToolAdapter => async (fetchFn, request, timeoutSignal) => {
  const body = anthropicToolRequestBody(request, thinking)
  const refused = tooLarge(body)
  if (refused) return refused
  const raw = await postJson(fetchFn, ANTHROPIC_MESSAGES_URL, { 'x-api-key': request.apiKey, 'anthropic-version': ANTHROPIC_VERSION }, body, request.signal, timeoutSignal, 'request-id')
  return isFailure(raw) ? raw : parseAnthropicToolStep(raw)
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TOOL_TRANSPORTS: Partial<Record<AdapterVersion, ToolAdapter>> = {
  'openai-responses-tool-loop-v1': makeOpenAiToolAdapter('none'),
  'openai-responses-reasoning-low-tool-loop-v1': makeOpenAiToolAdapter('low'),
  'anthropic-messages-tool-loop-v1': makeAnthropicToolAdapter('disabled'),
  'anthropic-messages-between-tools-tool-loop-v1': makeAnthropicToolAdapter('between_tools'),
  'anthropic-messages-adaptive-low-tool-loop-v1': makeAnthropicToolAdapter('adaptive-low'),
}

/**
 * The tool transport for a recorded version, or null for an unknown version, a version without the
 * tool loop, or another provider than the key about to be used: no send and no charge.
 */
export function toolAdapterFor(adapterVersion: string, provider: ProviderId): ToolAdapter | null {
  const profile = adapterProfile(adapterVersion)
  if (!profile || !profile.toolUse || profile.provider !== provider) return null
  return TOOL_TRANSPORTS[adapterVersion as AdapterVersion] ?? null
}
