/**
 * "Check key" (D-57): one free list-models request to the provider's fixed
 * endpoint, made server-side with the stored key. No model is called, nothing
 * is generated, and nothing counts against the call caps. Redirects are
 * refused so the key is never forwarded, the body is never read (only the
 * status matters), and no provider text or transport error reaches the caller.
 *
 * Google (spec 07 §6.6): its long-standing error shape answers a bad key with 400 and a reason token,
 * so for a Google 400 only, at most 4 KiB of the body is read and searched for the reason tokens
 * `API_KEY_INVALID`/`API_KEY_EXPIRED`. Nothing else from it is kept, stored, logged or returned.
 */

import type { ProviderId } from '../../domain/registry'
import { ANTHROPIC_VERSION } from './anthropic'
import { readCapped } from './common'
import { allowlistedFetch, PROVIDER_ORIGINS } from './endpoints'
import { googleErrorReasons } from './google'

export const KEY_CHECK_URLS: Readonly<Record<ProviderId, string>> = {
  openai: `${PROVIDER_ORIGINS.openai}/v1/models`,
  anthropic: `${PROVIDER_ORIGINS.anthropic}/v1/models?limit=1`,
  google: `${PROVIDER_ORIGINS.google}/v1beta/models?pageSize=1`,
}

/** Spec 07 §6.6: the most of a Google 400 body the check reads. */
export const KEY_CHECK_BODY_BYTES = 4 * 1024

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
  if (provider === 'openai') return { authorization: `Bearer ${apiKey}` }
  // Spec 07 §6.1: the key in a header, never `?key=` in the URL.
  if (provider === 'google') return { 'x-goog-api-key': apiKey }
  return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
}

/** A Google 400 names a bad key only through a reason token; anything else stays "unreachable". */
async function googleBadRequest(response: Response): Promise<KeyCheckOutcome> {
  let text: string | null = null
  try {
    text = await readCapped(response, KEY_CHECK_BODY_BYTES)
  } catch {
    text = null
  }
  let json: unknown = null
  try {
    json = text === null ? null : JSON.parse(text)
  } catch {
    json = null
  }
  const reasons = googleErrorReasons(json)
  return reasons.includes('API_KEY_INVALID') || reasons.includes('API_KEY_EXPIRED') ? { result: 'invalid', reason: 'AUTH_FAILED', httpStatus: 400 } : { result: 'unreachable', reason: 'UNEXPECTED_STATUS', httpStatus: 400 }
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
    // Spec 07 §6.5: the key only ever goes to its own provider's origin.
    response = await allowlistedFetch(fetchFn, provider)(KEY_CHECK_URLS[provider], { method: 'GET', headers: headersFor(provider, apiKey), redirect: 'manual', signal: timeout })
  } catch {
    // The error may quote the request; it is dropped, never logged or returned.
    return { result: 'unreachable', reason: timeout.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', httpStatus: null }
  }
  if (provider === 'google' && response.status === 400) return googleBadRequest(response)
  try {
    await response.body?.cancel()
  } catch {
    // Nothing in the body is needed.
  }
  return classifyKeyCheckStatus(response.status)
}
