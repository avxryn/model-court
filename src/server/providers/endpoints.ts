/**
 * The explicit outbound allowlist (spec 07 §6.5, D-107). Every request the Worker makes with a
 * judge's key goes through `allowlistedFetch`: https only, to one of the fixed provider origins, with
 * no userinfo and no explicit port, and with redirects refused. Anything else is refused before any
 * network I/O. There is no generic proxy, no base URL setting and no caller-chosen endpoint.
 */

import type { ProviderId } from '../../domain/registry'

export const PROVIDER_ORIGINS: Readonly<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
}

const ALLOWED = new Set<string>(Object.values(PROVIDER_ORIGINS))

/** Why a URL was refused; a fixed token, never the URL or any part of it. */
export type OutboundRefusal = 'unparseable' | 'not_https' | 'userinfo' | 'port' | 'origin' | 'wrong_provider' | 'redirect'

/** Thrown before any network I/O. Adapters map it to a definite, unsent `PROVIDER_REJECTED_REQUEST`. */
export class OutboundRefused extends Error {
  readonly outboundRefused = true
  constructor(readonly reason: OutboundRefusal) {
    super(`Outbound request refused (${reason}).`)
  }
}

export function isOutboundRefused(error: unknown): error is OutboundRefused {
  return error instanceof OutboundRefused || (typeof error === 'object' && error !== null && (error as { outboundRefused?: unknown }).outboundRefused === true)
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** The refusal for this request, or null when it may be sent. Pure; exported for tests. */
export function outboundRefusal(input: RequestInfo | URL, init: RequestInit | undefined, provider?: ProviderId): OutboundRefusal | null {
  let url: URL
  try {
    url = new URL(urlOf(input))
  } catch {
    return 'unparseable'
  }
  if (url.protocol !== 'https:') return 'not_https'
  if (url.username !== '' || url.password !== '') return 'userinfo'
  // `new URL` drops a default port (443), so any port left here was explicit and non-default; the raw
  // text is checked too, so `:443` is refused as well.
  if (url.port !== '' || /^https:\/\/[^/?#]*:\d*(?:[/?#]|$)/i.test(urlOf(input))) return 'port'
  if (!ALLOWED.has(url.origin)) return 'origin'
  if (provider !== undefined && url.origin !== PROVIDER_ORIGINS[provider]) return 'wrong_provider'
  const redirect = init?.redirect ?? (typeof input === 'object' && !(input instanceof URL) ? input.redirect : undefined)
  if (redirect !== 'manual') return 'redirect'
  return null
}

/**
 * Wraps a fetch so that it refuses, before any network I/O, every request that is not https, not on an
 * allowlisted origin (or, with `provider`, not on that provider's own origin), carries userinfo or an
 * explicit port, or does not refuse redirects. `log` receives `{event: 'outbound_refused', reason,
 * provider}` only: fixed tokens, never the URL.
 */
export function allowlistedFetch(inner: typeof fetch, provider?: ProviderId, log?: (event: Record<string, unknown>) => void): typeof fetch {
  return (input, init) => {
    const reason = outboundRefusal(input, init, provider)
    if (reason) {
      log?.({ event: 'outbound_refused', reason, provider: provider ?? null })
      return Promise.reject(new OutboundRefused(reason))
    }
    return inner(input, init)
  }
}
