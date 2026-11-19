/**
 * The input-token estimate the start dialog shows for an extraction hearing (spec 04 §10.3).
 * Labelled as an estimate: about 4 bytes a token for text, 4,500 tokens a native PDF page until
 * the `pdf` smoke check records a real number, plus about 300 for the provider's schema prompt.
 * Output tokens, reasoning and retries come on top. Pure.
 */

import type { CaseInput, Configuration } from '../contracts'
import { isImported } from '../contracts'
import type { ExtractionFields } from '../kits/extraction'
import { LIMITS } from '../limits'
import { utf8ByteLength } from '../text'

const tokens = (bytes: number) => Math.ceil(bytes / 4)

export interface InputEstimate {
  /** Per question, the tokens one call sends (instructions vary per party: the largest is used). */
  perCall: Array<{ caseKey: string; tokens: number; pdfPages: number }>
  total: number
  pdfPages: number
}

export function estimateExtractionInput(cases: readonly CaseInput[], configurations: readonly Configuration[], samples = 1): InputEstimate {
  const parties = configurations.filter((configuration) => !isImported(configuration))
  const system = Math.max(0, ...parties.map((party) => ('systemPrompt' in party ? tokens(utf8ByteLength(party.systemPrompt)) : 0)))
  const perCall = cases.map((testCase) => {
    const document = (testCase.kitFields as ExtractionFields | undefined)?.document
    const pdfPages = document?.delivery === 'pdf_native' ? (document.pageCount ?? 1) : 0
    const documentTokens = document ? (document.delivery === 'pdf_native' ? pdfPages * LIMITS.extraction.estimatedTokensPerPdfPage : tokens(document.byteLength)) : 0
    return { caseKey: testCase.key, tokens: system + tokens(utf8ByteLength(testCase.input)) + documentTokens + LIMITS.extraction.estimatedSchemaPromptTokens, pdfPages }
  })
  const total = perCall.reduce((sum, call) => sum + call.tokens, 0) * parties.length * samples
  return { perCall, total, pdfPages: perCall.reduce((sum, call) => sum + call.pdfPages, 0) }
}
