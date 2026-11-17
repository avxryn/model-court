/**
 * Short-lived holding place for an invitation secret across a sign-in
 * redirect (spec §9.3). The token arrives in the URL fragment, is moved here,
 * and is deleted after redemption, cancellation, sign-out, or 30 minutes.
 * It is never sent anywhere except the redeem POST body.
 */

const KEY = 'mc.pendingInvite'
const TTL_MS = 30 * 60 * 1000

function read(): { token: string; expiresAt: number } | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown }
    if (typeof value.token !== 'string' || typeof value.expiresAt !== 'number' || value.expiresAt < Date.now()) {
      sessionStorage.removeItem(KEY)
      return null
    }
    return { token: value.token, expiresAt: value.expiresAt }
  } catch {
    return null
  }
}

export const pendingInviteToken = {
  save(token: string) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ token, expiresAt: Date.now() + TTL_MS }))
    } catch {
      /* storage unavailable: redemption still works without a redirect */
    }
  },
  peek(): string | null {
    return read()?.token ?? null
  },
  clear() {
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
  },
}
