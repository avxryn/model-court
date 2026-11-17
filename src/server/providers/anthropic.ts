/**
 * Anthropic Messages API adapter (BYOK). Fixed endpoint; `x-api-key` with the
 * owner's workspace key; pinned API version; thinking disabled so the 512-token
 * cap is spent on visible text. Schema per platform.claude.com docs (2026-11-16);
 * live response mapping must be confirmed by the smoke record.
 */

import { classifyHttpError, finishText, isFailure, isRecord, nonNegativeInt, postJson, type Adapter } from './common'

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2026-10-21'

export function anthropicRequestBody(modelId: string, system: string, user: string, maxOutputTokens: number) {
  return {
    model: modelId,
    max_tokens: maxOutputTokens,
    system,
    messages: [{ role: 'user', content: user }],
    thinking: { type: 'disabled' },
  }
}

export const anthropicAdapter: Adapter = async (fetchFn, request, timeoutSignal) => {
  const raw = await postJson(
    fetchFn,
    ANTHROPIC_MESSAGES_URL,
    { 'x-api-key': request.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    anthropicRequestBody(request.modelId, request.system, request.user, request.maxOutputTokens),
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
