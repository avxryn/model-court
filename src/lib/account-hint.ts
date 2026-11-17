/**
 * A display-only hint that this browser was last signed in, so the static
 * landing page (which must make no auth request, see tests/smoke.spec.ts) can
 * show the same account chip as the app. It holds a first name and an
 * initial, never an email, token, or user ID, and it grants nothing: every
 * protected page still checks the real session.
 */

const KEY = 'mc-account-hint'

export interface AccountHint {
  name: string
  initial: string
}

export function readAccountHint(): AccountHint | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AccountHint>
    return typeof parsed.name === 'string' && typeof parsed.initial === 'string' ? { name: parsed.name.slice(0, 40), initial: parsed.initial.slice(0, 1) } : null
  } catch {
    return null
  }
}

export function writeAccountHint(user: { name?: string | null; email?: string | null }): void {
  const name = (user.name || '').trim().split(/\s+/)[0] || 'Your account'
  const initial = (user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ name, initial }))
  } catch {
    // Storage blocked: the landing page falls back to "Sign in".
  }
}

export function clearAccountHint(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
