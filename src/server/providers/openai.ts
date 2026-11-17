/**
 * OpenAI Responses API adapter (BYOK). Fixed endpoint; bearer auth with the
 * owner's key; reasoning disabled so the 512-token cap is spent on visible text;
 * storage off. Exact schema verified against developers.openai.com docs on
 * 2026-11-16; live response mapping must be confirmed by the smoke record.
 */

import type { TranscriptMessage } from '../../domain/contracts'
import { classifyHttpError, finishText, isFailure, isRecord, nonNegativeInt, postJson, type Adapter } from './common'

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

/** With a single user message this is byte-identical to the v1 body (D-39). */
export function openAiRequestBody(modelId: string, system: string, messages: readonly TranscriptMessage[], maxOutputTokens: number) {
  return {
    model: modelId,
    instructions: system,
    input: messages.map((message) =>
      message.role === 'user' ? { role: 'user', content: [{ type: 'input_text', text: message.content }] } : { role: 'assistant', content: [{ type: 'output_text', text: message.content }] },
    ),
    max_output_tokens: maxOutputTokens,
    reasoning: { effort: 'none' },
    store: false,
  }
}

export const openAiAdapter: Adapter = async (fetchFn, request, timeoutSignal) => {
  const raw = await postJson(
    fetchFn,
    OPENAI_RESPONSES_URL,
    { authorization: `Bearer ${request.apiKey}` },
    openAiRequestBody(request.modelId, request.system, request.messages, request.maxOutputTokens),
    request.signal,
    timeoutSignal,
    'x-request-id',
  )
  if (isFailure(raw)) return raw
  const base = { providerRequestId: raw.requestId, durationMs: raw.durationMs }

  if (raw.status < 200 || raw.status >= 300) {
    const error = isRecord(raw.json) && isRecord(raw.json.error) ? raw.json.error : {}
    const code = classifyHttpError(raw.status, {
      quota: error.code === 'insufficient_quota' || error.type === 'insufficient_quota',
      modelMissing: error.code === 'model_not_found',
    })
    return { kind: 'failure', code, definite: true, ...base }
  }

  const body = raw.json
  if (!isRecord(body) || !Array.isArray(body.output)) {
    return { kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, ...base }
  }
  if (body.status === 'failed') return { kind: 'failure', code: 'PROVIDER_UNAVAILABLE', definite: true, ...base }

  const texts: string[] = []
  const refusals: string[] = []
  for (const item of body.output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isRecord(part)) continue
      if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text)
      if (part.type === 'refusal' && typeof part.refusal === 'string') refusals.push(part.refusal)
    }
  }
  const incompleteReason = isRecord(body.incomplete_details) && typeof body.incomplete_details.reason === 'string' ? body.incomplete_details.reason : null
  const usage = isRecord(body.usage) ? body.usage : {}
  // A textual refusal is a gradable output; a block without text is a failure.
  const text = texts.length > 0 ? texts.join('') : refusals.join('')
  return finishText(text, {
    ...base,
    finishReason: body.status === 'incomplete' ? `incomplete:${incompleteReason ?? 'unknown'}` : typeof body.status === 'string' ? body.status : null,
    inputTokens: nonNegativeInt(usage.input_tokens),
    outputTokens: nonNegativeInt(usage.output_tokens),
    observedModel: typeof body.model === 'string' ? body.model : null,
    truncated: incompleteReason === 'max_output_tokens',
  })
}
