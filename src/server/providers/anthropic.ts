/**
 * Anthropic Messages API adapter (BYOK). Fixed endpoint; `x-api-key` with the
 * owner's workspace key; pinned API version; thinking disabled (or turned as far
 * down as each model allows, D-48) so the 512-token cap is spent on visible text. Schema per platform.claude.com docs (2026-11-16);
 * live response mapping must be confirmed by the smoke record.
 */

import type { TranscriptMessage } from '../../domain/contracts'
import { LIMITS } from '../../domain/limits'
import { classifyHttpError, finishText, isFailure, isRecord, nonNegativeInt, postJson, type Adapter } from './common'

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2026-10-21'

/**
 * How the request turns thinking down (D-48), per the thinking docs' per-model table:
 * - `disabled`: `thinking: {type: "disabled"}` (`anthropic-messages-v1`/`-v2`).
 * - `between_tools`: Claude Sonnet 5.5 rejects `disabled`; `between_tools` turns off up-front
 *   thinking, and with no tools the reply is text only (`anthropic-messages-between-tools-v1`).
 * - `adaptive-low`: Fable and Opus 5.5 cannot turn thinking off, so effort goes to `low` and the
 *   cap gets `LIMITS.reasoningHeadroomTokens`, since thinking counts toward `max_tokens`
 *   (`anthropic-messages-adaptive-low-v1`). Thinking text stays omitted.
 */
export type AnthropicThinking = 'disabled' | 'between_tools' | 'adaptive-low'

/** With a single user message and thinking `disabled` this is byte-identical to the v1 body (D-39). */
export function anthropicRequestBody(modelId: string, system: string, messages: readonly TranscriptMessage[], maxOutputTokens: number, thinking: AnthropicThinking = 'disabled') {
  const base = {
    model: modelId,
    max_tokens: thinking === 'adaptive-low' ? maxOutputTokens + LIMITS.reasoningHeadroomTokens : maxOutputTokens,
    system,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
  }
  if (thinking === 'adaptive-low') return { ...base, thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'low' } }
  return { ...base, thinking: { type: thinking } }
}

export const makeAnthropicAdapter = (thinking: AnthropicThinking): Adapter => async (fetchFn, request, timeoutSignal) => {
  const raw = await postJson(
    fetchFn,
    ANTHROPIC_MESSAGES_URL,
    { 'x-api-key': request.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    anthropicRequestBody(request.modelId, request.system, request.messages, request.maxOutputTokens, thinking),
    request.signal,
    timeoutSignal,
    'request-id',
  )
  if (isFailure(raw)) return raw
  const base = { providerRequestId: raw.requestId, durationMs: raw.durationMs }

  if (raw.status < 200 || raw.status >= 300) {
    const error = isRecord(raw.json) && isRecord(raw.json.error) ? raw.json.error : {}
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
    const code = raw.status === 529
      ? 'PROVIDER_UNAVAILABLE'
      : classifyHttpError(raw.status, {
          quota: error.type === 'billing_error' || message.includes('credit balance'),
          modelMissing: error.type === 'not_found_error',
        })
    return { kind: 'failure', code, definite: true, ...base }
  }

  const body = raw.json
  if (!isRecord(body) || !Array.isArray(body.content)) {
    return { kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, ...base }
  }
  const text = body.content
    .filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
  const stopReason = typeof body.stop_reason === 'string' ? body.stop_reason : null
  if (text.trim() === '' && stopReason === 'refusal') {
    return { kind: 'failure', code: 'PROVIDER_BLOCKED', definite: true, ...base }
  }
  const usage = isRecord(body.usage) ? body.usage : {}
  return finishText(text, {
    ...base,
    finishReason: stopReason,
    inputTokens: nonNegativeInt(usage.input_tokens),
    outputTokens: nonNegativeInt(usage.output_tokens),
    observedModel: typeof body.model === 'string' ? body.model : null,
    truncated: stopReason === 'max_tokens',
  })
}

/** Thinking disabled: the `anthropic-messages-v1` and `-v2` transport. */
export const anthropicAdapter = makeAnthropicAdapter('disabled')
