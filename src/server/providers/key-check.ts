/**
 * "Check key" (D-57): one free list-models request to the provider's fixed
 * endpoint, made server-side with the stored key. No model is called, nothing
 * is generated, and nothing counts against the call caps. Redirects are
 * refused so the key is never forwarded, the body is never read (only the
 * status matters), and no provider text or transport error reaches the caller.
 */

import type { ProviderId } from '../../domain/registry'
import { ANTHROPIC_VERSION } from './anthropic'

export const KEY_CHECK_URLS: Readonly<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models?limit=1',
}

export const KEY_CHECK_TIMEOUT_MS = 10_000

/**
 * - `valid`: the provider accepted the key.
 * - `invalid`: the provider rejected the key (401).
 * - `restricted`: the key was recognised but may not list models (403); a key
 *   limited to one API can still be able to generate.
 * - `unreachable`: no answer about the key (network, timeout, 429, 5xx, redirect, other).
 */
export type KeyCheckResult = 'valid' | 'invalid' | 'restricted' | 'unreachable'

export interface KeyCheckOutcome {
  result: KeyCheckResult
  /** Safe, allowlisted reason. Never provider text. */
  reason: 'OK' | 'AUTH_FAILED' | 'ACCESS_DENIED' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'NETWORK_ERROR' | 'REDIRECT_REFUSED' | 'UNEXPECTED_STATUS'
  httpStatus: number | null
}

function headersFor(provider: ProviderId, apiKey: string): Record<string, string> {
  return provider === 'openai' ? { authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
}

export function classifyKeyCheckStatus(status: number): KeyCheckOutcome {
  if (status >= 200 && status < 300) return { result: 'valid', reason: 'OK', httpStatus: status }
  if (status >= 300 && status < 400) return { result: 'unreachable', reason: 'REDIRECT_REFUSED', httpStatus: status }
  if (status === 401) return { result: 'invalid', reason: 'AUTH_FAILED', httpStatus: status }
  if (status === 403) return { result: 'restricted', reason: 'ACCESS_DENIED', httpStatus: status }
  if (status === 429) return { result: 'unreachable', reason: 'RATE_LIMITED', httpStatus: status }
  if (status >= 500) return { result: 'unreachable', reason: 'PROVIDER_ERROR', httpStatus: status }
  return { result: 'unreachable', reason: 'UNEXPECTED_STATUS', httpStatus: status }
}

export async function checkProviderKey(fetchFn: typeof fetch, provider: ProviderId, apiKey: string, timeoutMs = KEY_CHECK_TIMEOUT_MS): Promise<KeyCheckOutcome> {
  const timeout = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetchFn(KEY_CHECK_URLS[provider], { method: 'GET', headers: headersFor(provider, apiKey), redirect: 'manual', signal: timeout })
  } catch {
    // The error may quote the request; it is dropped, never logged or returned.
    return { result: 'unreachable', reason: timeout.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', httpStatus: null }
  }
  try {
    await response.body?.cancel()
  } catch {
    // Nothing in the body is needed.
  }
  return classifyKeyCheckStatus(response.status)
}
