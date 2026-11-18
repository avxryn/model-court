/**
 * Provider-call caps as a judge sees them (spec §6.5, D-57). Pure: the server
 * computes the standing from its budget buckets; the browser uses the same
 * rule to explain why Start is disabled. The server stays the authority.
 */

export interface CallCaps {
  dailyPerUser: number
  dailyGlobal: number
  lifetimeGlobal: number
}

export interface CallUsage {
  userToday: number
  globalToday: number
  globalLifetime: number
}

export interface Allowance {
  limit: number
  used: number
  remaining: number
}

export interface QuotaStanding {
  user: Allowance
  globalToday: Allowance
  globalLifetime: Allowance
  /** The most calls one new request from this judge could reserve right now. */
  available: number
  /** Start of the next UTC day, when both daily allowances reset. */
  resetsAt: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function allowance(limit: number, used: number): Allowance {
  const safeUsed = Math.max(0, used)
  return { limit, used: safeUsed, remaining: Math.max(0, limit - safeUsed) }
}

export function quotaStanding(caps: CallCaps, usage: CallUsage, now: number): QuotaStanding {
  const user = allowance(caps.dailyPerUser, usage.userToday)
  const globalToday = allowance(caps.dailyGlobal, usage.globalToday)
  const globalLifetime = allowance(caps.lifetimeGlobal, usage.globalLifetime)
  return {
    user,
    globalToday,
    globalLifetime,
    available: Math.min(user.remaining, globalToday.remaining, globalLifetime.remaining),
    resetsAt: (Math.floor(now / DAY_MS) + 1) * DAY_MS,
  }
}

/** Paid calls a draft plans: questions × generated parties × samples (D-65). Imported parties make none. */
export function plannedCalls(draft: { cases: readonly unknown[]; configurations: ReadonlyArray<{ kind?: string }>; samplesPerAnswer?: number }): number {
  const generated = draft.configurations.filter((configuration) => configuration.kind !== 'imported').length
  return draft.cases.length * generated * (generated > 0 ? (draft.samplesPerAnswer ?? 1) : 1)
}

export type QuotaBlock = { cap: 'user' | 'globalToday' | 'globalLifetime'; message: string }

/** Why `planned` calls cannot start now, naming the tightest cap; null when they fit. */
export function quotaBlock(planned: number, standing: QuotaStanding): QuotaBlock | null {
  if (planned <= 0 || planned <= standing.available) return null
  const calls = (n: number) => `${n} ${n === 1 ? 'call' : 'calls'}`
  const needs = `This hearing needs ${calls(planned)}`
  // On a tie the lifetime cap wins: waiting for the daily reset would not help.
  const tightest = (['globalLifetime', 'user', 'globalToday'] as const).reduce((best, cap) => (standing[cap].remaining < standing[best].remaining ? cap : best))
  const left = standing[tightest].remaining
  const limit = standing[tightest].limit
  const message = {
    user: `${needs}, but you have ${calls(left)} left today (${limit} a day per judge). Remove questions or parties, or start after the daily reset.`,
    globalToday: `${needs}, but this deployment has ${calls(left)} left today (${limit} a day shared by everyone). Try again after the daily reset.`,
    globalLifetime: `${needs}, but this deployment has ${calls(left)} left of its ${limit}-call lifetime cap. Import answers instead, or ask the operator.`,
  }[tightest]
  return { cap: tightest, message }
}
