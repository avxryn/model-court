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

/**
 * Paid calls one answer of a question may make: 1, or a tool question's step cap (spec 06 §7.1,
 * D-99), read from its kit fields so the browser and admission count alike.
 */
export function callsPerAnswer(testCase: unknown): number {
  const fields = (testCase as { kitFields?: { kind?: string; maxSteps?: unknown } } | null)?.kitFields
  return fields?.kind === 'tools' && typeof fields.maxSteps === 'number' ? fields.maxSteps : 1
}

/**
 * Paid calls a draft plans: per question, generated parties × samples (D-65) × calls per answer.
 * Imported parties make none. For a tool hearing this is the upper bound (`plannedCallsAreUpperBound`).
 */
export function plannedCalls(draft: { cases: readonly unknown[]; configurations: ReadonlyArray<{ kind?: string }>; samplesPerAnswer?: number }): number {
  const generated = draft.configurations.filter((configuration) => configuration.kind !== 'imported').length
  const perAnswer = draft.cases.reduce<number>((sum, testCase) => sum + callsPerAnswer(testCase), 0)
  return perAnswer * generated * (generated > 0 ? (draft.samplesPerAnswer ?? 1) : 1)
}

/** Spec 06 §5.2: a tool question's calls are a cap, not an exact count. */
export function plannedCallsAreUpperBound(draft: { cases: readonly unknown[] }): boolean {
  return draft.cases.some((testCase) => callsPerAnswer(testCase) > 1)
}

/**
 * With repeats (D-65): when the planned calls do not fit but asking once would, the line that says
 * so ("Ask each party once instead (15 calls)."); null otherwise.
 */
export function repeatHint(draft: Parameters<typeof plannedCalls>[0], standing: QuotaStanding): string | null {
  if ((draft.samplesPerAnswer ?? 1) <= 1) return null
  const planned = plannedCalls(draft)
  const once = plannedCalls({ ...draft, samplesPerAnswer: 1 })
  if (!quotaBlock(planned, standing) || quotaBlock(once, standing)) return null
  return `Ask each party once instead (${once} ${once === 1 ? 'call' : 'calls'}).`
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
