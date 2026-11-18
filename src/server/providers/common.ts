/**
 * Shared transport rules for the two fixed-endpoint BYOK adapters (spec §6.4, §6.6):
 * non-streaming POST, redirects refused (credentials are never forwarded), a
 * response-body byte ceiling before parsing, normalized outcomes, no retries.
 */

import type { TranscriptMessage } from '../../domain/contracts'
import { LIMITS } from '../../domain/limits'
import { utf8ByteLength } from '../../domain/text'

export interface ProviderRequest {
  modelId: string
  system: string
  /** Alternating turns ending with the user (D-39); a single user message for `qa-v1`. */
  messages: TranscriptMessage[]
  maxOutputTokens: number
  apiKey: string
  signal: AbortSignal
}

export type ProviderErrorCode =
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_ACCESS_DENIED'
  | 'PROVIDER_MODEL_UNAVAILABLE'
  | 'PROVIDER_QUOTA_EXHAUSTED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REJECTED_REQUEST'
  | 'PROVIDER_BLOCKED'
  | 'PROVIDER_REDIRECT_REFUSED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_NETWORK_ERROR'
  | 'PROVIDER_CANCELED'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'OUTPUT_TOO_LARGE'
  | 'EMPTY_OUTPUT'
  // Pre-send credential failures: these never reach the network.
  | 'CREDENTIAL_REVOKED'
  | 'CREDENTIAL_EXPIRED'
  | 'CREDENTIAL_UNAVAILABLE'

export interface ProviderSuccess {
  kind: 'success'
  text: string
  finishReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  /** Cached input tokens as the provider reports them; null when not reported (D-64). */
  cachedInputTokens: number | null
  /** Reasoning or thinking tokens, already counted in `outputTokens`; null when not reported. */
  reasoningTokens: number | null
  providerRequestId: string | null
  observedModel: string | null
  durationMs: number
  truncated: boolean
}

export interface ProviderFailure {
  kind: 'failure'
  code: ProviderErrorCode
  /** false when the provider may have accepted (and billed) the request. */
  definite: boolean
  providerRequestId: string | null
  durationMs: number
}

export type ProviderOutcome = ProviderSuccess | ProviderFailure

export type Adapter = (fetchFn: typeof fetch, request: ProviderRequest, timeoutSignal: AbortSignal) => Promise<ProviderOutcome>

export interface RawResponse {
  status: number
  requestId: string | null
  json: unknown
  durationMs: number
}

async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/**
 * POST JSON to a fixed provider URL. Returns the parsed body or a normalized
 * transport failure. `timeoutSignal` distinguishes deadline from cancellation.
 */
export async function postJson(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
  requestIdHeader: string,
): Promise<RawResponse | ProviderFailure> {
  const started = performance.now()
  const elapsed = () => Math.max(0, Math.round(performance.now() - started))
  let response: Response
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal,
    })
  } catch {
    // The request may have reached the provider before the connection failed.
    const code = timeoutSignal.aborted ? 'PROVIDER_TIMEOUT' : signal.aborted ? 'PROVIDER_CANCELED' : 'PROVIDER_NETWORK_ERROR'
    return { kind: 'failure', code, definite: false, providerRequestId: null, durationMs: elapsed() }
  }
  const requestId = response.headers.get(requestIdHeader)
  if (response.status >= 300 && response.status < 400) {
    return { kind: 'failure', code: 'PROVIDER_REDIRECT_REFUSED', definite: true, providerRequestId: requestId, durationMs: elapsed() }
  }
  let text: string | null
  try {
    text = await readCapped(response, LIMITS.providerResponseBodyBytes)
  } catch {
    const code = timeoutSignal.aborted ? 'PROVIDER_TIMEOUT' : signal.aborted ? 'PROVIDER_CANCELED' : 'PROVIDER_NETWORK_ERROR'
    return { kind: 'failure', code, definite: false, providerRequestId: requestId, durationMs: elapsed() }
  }
  if (text === null) return { kind: 'failure', code: 'OUTPUT_TOO_LARGE', definite: true, providerRequestId: requestId, durationMs: elapsed() }
  let json: unknown = null
  try {
    json = text === '' ? null : JSON.parse(text)
  } catch {
    json = undefined
  }
  if (json === undefined && response.ok) {
    return { kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, providerRequestId: requestId, durationMs: elapsed() }
  }
  return { status: response.status, requestId, json, durationMs: elapsed() }
}

export function isFailure(value: RawResponse | ProviderFailure): value is ProviderFailure {
  return (value as ProviderFailure).kind === 'failure'
}

/** Status-based normalization shared by both providers; provider-specific hints refine it. */
export function classifyHttpError(status: number, hint: { quota?: boolean; modelMissing?: boolean }): ProviderErrorCode {
  if (hint.quota) return 'PROVIDER_QUOTA_EXHAUSTED'
  if (status === 401) return 'PROVIDER_AUTH_FAILED'
  if (status === 402) return 'PROVIDER_QUOTA_EXHAUSTED'
  if (status === 403) return 'PROVIDER_ACCESS_DENIED'
  if (status === 404 || hint.modelMissing) return 'PROVIDER_MODEL_UNAVAILABLE'
  if (status === 429) return 'PROVIDER_RATE_LIMITED'
  if (status >= 500) return 'PROVIDER_UNAVAILABLE'
  return 'PROVIDER_REJECTED_REQUEST'
}

export function finishText(
  text: string,
  fields: Omit<ProviderSuccess, 'kind' | 'text'>,
): ProviderOutcome {
  if (text.trim().length === 0) {
    return { kind: 'failure', code: 'EMPTY_OUTPUT', definite: true, providerRequestId: fields.providerRequestId, durationMs: fields.durationMs }
  }
  if (utf8ByteLength(text) > LIMITS.providerOutputBytes) {
    return { kind: 'failure', code: 'OUTPUT_TOO_LARGE', definite: true, providerRequestId: fields.providerRequestId, durationMs: fields.durationMs }
  }
  return { kind: 'success', text, ...fields }
}

export function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** `parent[key]` when it is a JSON object, else an empty one. */
export function subRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key]
  return isRecord(value) ? value : {}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
