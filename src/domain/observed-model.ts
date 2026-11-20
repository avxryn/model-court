import type { ProviderId } from './registry'

/**
 * Spec 07 Q1 (D-115): Google reports the model that answered (`modelVersion`), and may route a request
 * to another model than the one asked for. The record says so after unsealing. A stable version suffix
 * on the same model (`gemini-3.6-flash-001` for `gemini-3.6-flash`) is the same model. OpenAI and
 * Anthropic report dated snapshot names for an alias, so only Google is compared. Null when it matches
 * or nothing was reported.
 */
export function observedModelNote(provider: ProviderId, requested: string, observed: string | null): string | null {
  if (provider !== 'google' || observed === null || observed.trim() === '') return null
  const seen = observed.trim().replace(/^models\//, '')
  // A stable version suffix: the requested ID, a dash and three digits.
  const stable = seen.startsWith(`${requested}-`) && /^\d{3}$/.test(seen.slice(requested.length + 1))
  if (seen === requested || stable) return null
  return `Google reported that ${seen} answered, not ${requested}, the model this hearing asked for.`
}
