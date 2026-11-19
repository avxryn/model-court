/**
 * OpenAI Responses API adapter (BYOK). Fixed endpoint; bearer auth with the
 * owner's key; reasoning disabled (or, where a model refuses that, low effort with
 * extra room, D-48) so the 512-token cap is spent on visible text;
 * storage off. Exact schema verified against developers.openai.com docs on
 * 2026-11-16; live response mapping must be confirmed by the smoke record.
 */

import type { TranscriptMessage } from '../../domain/contracts'
import { LIMITS } from '../../domain/limits'
import { classifyHttpError, featureRejection, featuresOf, finishText, isFailure, isRecord, nonNegativeInt, postJson, subRecord, type Adapter, type RequestFeatures } from './common'

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

/**
 * `none`: reasoning off (`openai-responses-v1`/`-v2`). `low`: for models that reject `none`
 * (`openai-responses-reasoning-low-v1`, D-48); reasoning counts against `max_output_tokens`,
 * so the cap gets `LIMITS.reasoningHeadroomTokens` on top.
 */
export type OpenAiReasoning = 'none' | 'low'

/**
 * With a single user message and reasoning `none` this is byte-identical to the v1 body (D-39).
 * Features (spec 04 §6.2, D-86; `openai-responses-v3` and `-reasoning-low-v2` only): a PDF as an
 * `input_file` part before the first user text, with the fixed name `document.pdf` and `detail`
 * unset; a strict `json_schema` text format. Without features the body is the predecessor's.
 */
export function openAiRequestBody(modelId: string, system: string, messages: readonly TranscriptMessage[], maxOutputTokens: number, reasoning: OpenAiReasoning = 'none', features: RequestFeatures = {}) {
  const firstUser = messages.findIndex((message) => message.role === 'user')
  return {
    model: modelId,
    instructions: system,
    input: messages.map((message, index) =>
      message.role === 'user'
        ? {
            role: 'user',
            content: [
              ...(features.document && index === firstUser ? [{ type: 'input_file', filename: 'document.pdf', file_data: `data:${features.document.mediaType};base64,${features.document.base64}` }] : []),
              { type: 'input_text', text: message.content },
            ],
          }
        : { role: 'assistant', content: [{ type: 'output_text', text: message.content }] },
    ),
    ...(features.responseFormat ? { text: { format: { type: 'json_schema', name: features.responseFormat.name, strict: true, schema: features.responseFormat.schema } } } : {}),
    max_output_tokens: reasoning === 'none' ? maxOutputTokens : maxOutputTokens + LIMITS.reasoningHeadroomTokens,
    reasoning: { effort: reasoning },
    store: false,
  }
}

/** `withFeatures`: the version may carry structured output and a PDF (spec 04 §6.4); older versions never send them. */
export const makeOpenAiAdapter = (reasoning: OpenAiReasoning, withFeatures = false): Adapter => async (fetchFn, request, timeoutSignal) => {
  const features = withFeatures ? featuresOf(request) : {}
  const raw = await postJson(
    fetchFn,
    OPENAI_RESPONSES_URL,
    { authorization: `Bearer ${request.apiKey}` },
    openAiRequestBody(request.modelId, request.system, request.messages, request.maxOutputTokens, reasoning, features),
    request.signal,
    timeoutSignal,
    'x-request-id',
  )
  if (isFailure(raw)) return raw
  const base = { providerRequestId: raw.requestId, durationMs: raw.durationMs }

  if (raw.status < 200 || raw.status >= 300) {
    const error = isRecord(raw.json) && isRecord(raw.json.error) ? raw.json.error : {}
    const code =
      featureRejection(raw.status, typeof error.message === 'string' ? error.message : '', features) ??
      classifyHttpError(raw.status, {
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
    // Included in input_tokens (OpenAI prompt caching guide); reasoning is included in output_tokens.
    cachedInputTokens: nonNegativeInt(subRecord(usage, 'input_tokens_details').cached_tokens),
    reasoningTokens: nonNegativeInt(subRecord(usage, 'output_tokens_details').reasoning_tokens),
    observedModel: typeof body.model === 'string' ? body.model : null,
    truncated: incompleteReason === 'max_output_tokens',
  })
}

/** Reasoning off: the `openai-responses-v1` and `-v2` transport. */
export const openAiAdapter = makeOpenAiAdapter('none')
