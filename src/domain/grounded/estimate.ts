/**
 * The input-size estimate the start dialog shows for a grounded hearing (spec 05 §10, D-95).
 * Labelled as an estimate: about 4 bytes a token (more tokens per character for many languages
 * and for code), plus the template's fixed wording and its JSON. Sources go with every call, so
 * they count once per party and sample. Output tokens, reasoning and retries come on top. Pure.
 */

import { isImported, type CaseInput, type Configuration } from '../contracts'
import type { GroundedFields } from '../kits/grounded'
import { utf8ByteLength } from '../text'

/** UTF-8 bytes of `grounded-v1`'s fixed instructions and JSON framing, rounded up. */
export const GROUNDED_TEMPLATE_BYTES = 640
/** JSON framing per source (`{"id":"S10","title":"","text":""},`). */
const PER_SOURCE_BYTES = 40

const tokens = (bytes: number) => Math.ceil(bytes / 4)

export interface GroundedEstimate {
  /** Per question, the tokens one call sends (instructions vary per party: the largest is used). */
  perCall: Array<{ caseKey: string; tokens: number }>
  /** Calls that would be made: questions × generated parties × samples. */
  calls: number
  total: number
}

export function estimateGroundedInput(cases: readonly CaseInput[], configurations: readonly Configuration[], samples = 1): GroundedEstimate {
  const parties = configurations.filter((configuration) => !isImported(configuration))
  const system = Math.max(0, ...parties.map((party) => ('systemPrompt' in party ? utf8ByteLength(party.systemPrompt) : 0)))
  const perCall = cases.map((testCase) => {
    const sources = (testCase.kitFields as GroundedFields | undefined)?.sources ?? []
    const sourceBytes = sources.reduce((sum, source) => sum + source.byteLength + PER_SOURCE_BYTES, 0)
    return { caseKey: testCase.key, tokens: tokens(system + GROUNDED_TEMPLATE_BYTES + utf8ByteLength(testCase.input) + sourceBytes) }
  })
  const calls = cases.length * parties.length * samples
  return { perCall, calls, total: perCall.reduce((sum, call) => sum + call.tokens, 0) * parties.length * samples }
}
