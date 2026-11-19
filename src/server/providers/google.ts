/**
 * Google Gemini API adapter (BYOK, spec 07 §6.3, D-108). Fixed endpoint: the stateless
 * `generateContent` on `v1beta`; the judge's Google AI Studio key in the `x-goog-api-key` header,
 * never in the URL; `store: false` on every request so the project's request logs keep nothing.
 * Thinking is turned as far down as each model allows (D-48), with the reasoning headroom where it
 * cannot be turned off. No tools, safety settings, temperature or cached content are ever sent, so
 * these versions carry no structured output, PDF input or tool loop. Schema per
 * aistudio.google.com docs (read 2026-11-18/19); live response mapping must be confirmed by the
 * smoke record before any route is enabled.
 */

import type { TranscriptMessage } from '../../domain/contracts'
import { LIMITS } from '../../domain/limits'
import { classifyHttpError, finishText, isFailure, isRecord, nonNegativeInt, postJson, type Adapter, type ProviderErrorCode } from './common'
import { PROVIDER_ORIGINS } from './endpoints'

/** Registry model IDs only; checked again here so the path can never carry anything else. */
export const GOOGLE_MODEL_ID = /^[a-z0-9][a-z0-9.-]*$/

export const googleGenerateUrl = (modelId: string) => `${PROVIDER_ORIGINS.google}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`

/**
 * - `low`: `thinkingLevel: "low"` for models that cannot turn thinking off (`google-generate-low-v1`).
 * - `minimal`: `thinkingLevel: "minimal"`, which makes thinking unlikely but not impossible
 *   (`google-generate-minimal-v1`); it keeps the headroom for that reason.
 * - `budget-off`: `thinkingBudget: 0`, thinking off (`google-generate-budget-off-v1`, Gemini 2.5 only).
 * Never both fields: Gemini 4 answers a request with both with a 400.
 */
export type GoogleThinking = 'low' | 'minimal' | 'budget-off'

export function googleRequestBody(system: string, messages: readonly TranscriptMessage[], maxOutputTokens: number, thinking: GoogleThinking) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
    generationConfig: {
      maxOutputTokens: thinking === 'budget-off' ? maxOutputTokens : maxOutputTokens + LIMITS.reasoningHeadroomTokens,
      thinkingConfig: thinking === 'budget-off' ? { thinkingBudget: 0 } : { thinkingLevel: thinking },
    },
    store: false,
  }
}

/** Finish reasons that mean the provider's own filters stopped the answer. */
const BLOCKED_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'LANGUAGE'])
const AUTH_REASONS = new Set(['API_KEY_INVALID', 'API_KEY_EXPIRED'])

/**
 * The reason tokens of a Google error body (`error.details[].reason`), from fixed fields only. Never
 * `message`: provider text is never stored, logged or returned.
 */
export function googleErrorReasons(json: unknown): string[] {
  const error = isRecord(json) && isRecord(json.error) ? json.error : {}
  const details = Array.isArray(error.details) ? error.details : []
  return details.flatMap((detail) => (isRecord(detail) && typeof detail.reason === 'string' ? [detail.reason] : []))
}

/**
 * Both documented error shapes: the long-standing `{error: {code: 400, status: 'INVALID_ARGUMENT',
 * details: [{reason}]}}` and the newer `{error: {code: 'authentication'}}`. Only `error.code`,
 * `error.status` and `error.details[].reason` are read, each against a fixed list.
 */
export function googleFailure(status: number, json: unknown): { code: ProviderErrorCode; definite: boolean } {
  const error = isRecord(json) && isRecord(json.error) ? json.error : {}
  const token = typeof error.code === 'string' ? error.code : null
  const statusToken = typeof error.status === 'string' ? error.status : null
  const reasons = googleErrorReasons(json)
  if (status === 401 || token === 'authentication' || reasons.some((reason) => AUTH_REASONS.has(reason))) return { code: 'PROVIDER_AUTH_FAILED', definite: true }
  // Google may already have spent thinking tokens: possibly billed, like a timeout.
  if (status === 504 || status === 499 || statusToken === 'DEADLINE_EXCEEDED') return { code: 'PROVIDER_UNAVAILABLE', definite: false }
  return {
    code: classifyHttpError(status, {
      quota: status === 402 || token === 'payment_required' || (status === 429 && token === 'quota_exceeded'),
      modelMissing: token === 'model_not_found',
      accessDenied: status === 400 && statusToken === 'FAILED_PRECONDITION',
    }),
    definite: true,
  }
}

export const makeGoogleAdapter = (thinking: GoogleThinking): Adapter => async (fetchFn, request, timeoutSignal) => {
  if (!GOOGLE_MODEL_ID.test(request.modelId)) return { kind: 'failure', code: 'PROVIDER_REJECTED_REQUEST', definite: true, providerRequestId: null, durationMs: 0, unsent: true }
  const raw = await postJson(
    fetchFn,
    googleGenerateUrl(request.modelId),
    { 'x-goog-api-key': request.apiKey },
    googleRequestBody(request.system, request.messages, request.maxOutputTokens, thinking),
    request.signal,
    timeoutSignal,
    // No request-ID response header is documented; the body's `responseId` stands in.
    null,
  )
  if (isFailure(raw)) return raw
  const body = raw.json
  const responseId = isRecord(body) && typeof body.responseId === 'string' ? body.responseId : null
  const base = { providerRequestId: raw.requestId ?? responseId, durationMs: raw.durationMs }

  if (raw.status < 200 || raw.status >= 300) return { kind: 'failure', ...googleFailure(raw.status, raw.json), ...base }
  if (!isRecord(body)) return { kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, ...base }

  const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined
  if (!isRecord(candidate)) {
    const blocked = isRecord(body.promptFeedback) && typeof body.promptFeedback.blockReason === 'string'
    return { kind: 'failure', code: blocked ? 'PROVIDER_BLOCKED' : 'INVALID_PROVIDER_RESPONSE', definite: true, ...base }
  }
  const parts = isRecord(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : []
  // Thought parts and `thoughtSignature` are never part of the answer.
  const text = parts
    .filter((part): part is { text: string } => isRecord(part) && typeof part.text === 'string' && part.thought !== true)
    .map((part) => part.text)
    .join('')
  const finishReason = typeof candidate.finishReason === 'string' ? candidate.finishReason : null
  const blocked = finishReason !== null && BLOCKED_FINISH.has(finishReason)
  if (blocked && text.trim() === '') return { kind: 'failure', code: 'PROVIDER_BLOCKED', definite: true, ...base }

  const usage = isRecord(body.usageMetadata) ? body.usageMetadata : {}
  const candidates = nonNegativeInt(usage.candidatesTokenCount)
  const thoughts = nonNegativeInt(usage.thoughtsTokenCount)
  return finishText(text, {
    ...base,
    finishReason,
    inputTokens: nonNegativeInt(usage.promptTokenCount),
    // Billed output: the answer plus thinking, like the other providers' output_tokens.
    outputTokens: candidates === null ? null : candidates + (thoughts ?? 0),
    // Included in promptTokenCount (implicit caching; this app never sends cachedContent).
    cachedInputTokens: nonNegativeInt(usage.cachedContentTokenCount),
    reasoningTokens: thoughts,
    observedModel: typeof body.modelVersion === 'string' ? body.modelVersion : null,
    // Text kept after a filter stop is marked cut off, like Anthropic's "text plus refusal".
    truncated: finishReason === 'MAX_TOKENS' || blocked,
  })
}
