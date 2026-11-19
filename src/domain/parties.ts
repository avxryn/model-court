/**
 * More than three parties (spec 07 §9, D-110). Browser-safe, pure.
 *
 * Every juror scores every testimony, so the hearing's size is capped by testimonies (parties ×
 * questions, imported parties included), not by parties alone. Blind labels go to A–E, and a
 * balanced rotation spreads parties evenly over the positions across a hearing's review sessions.
 */

import { LIMITS } from './limits'

export const BLIND_LABELS = ['A', 'B', 'C', 'D', 'E'] as const
export type BlindLabel = (typeof BLIND_LABELS)[number]

/** One testimony at a time (tabs) from this many parties on (spec 07 §9.2). */
export const ONE_AT_A_TIME_FROM = 4

/** The plain-words refusal when parties × questions passes the limit, or null when it fits. */
export function testimonyLimitMessage(parties: number, questions: number): string | null {
  const total = parties * questions
  if (total <= LIMITS.maxTestimoniesPerHearing) return null
  return `${parties} parties × ${questions} ${questions === 1 ? 'question' : 'questions'} is ${total} answers for each juror to score. The limit is ${LIMITS.maxTestimoniesPerHearing}: remove a question or a party. To compare more setups, re-hear this case with an anchor party.`
}

/** The most questions a hearing with this many parties may hold. */
export function maxQuestionsFor(parties: number): number {
  return Math.min(LIMITS.maxCases, Math.floor(LIMITS.maxTestimoniesPerHearing / Math.max(1, parties)))
}

/**
 * Balanced rotation (spec 07 §9.2, Q8): session k sees question q's parties in the order
 * `base[(i + k) mod n]` for position i. Over n sessions every party sits in every position exactly
 * once; with fewer sessions, as evenly as possible.
 */
export function rotate<T>(base: readonly T[], k: number): T[] {
  const n = base.length
  if (n === 0) return []
  const shift = ((k % n) + n) % n
  return base.map((_, i) => base[(i + shift) % n])
}
