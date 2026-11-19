/**
 * `grounded-v1` (spec 05, D-92): compare how setups answer from numbered sources a retriever
 * returned. Each question holds its request, 1–10 sources (stored beside the draft, referenced
 * by hash in `kitFields.sources`) and the judge's grounding key: whether the sources answer it
 * (`yes`, `partly`, `no`) and which sources a good answer must cite. Every party gets the same
 * sources in the same order under template `grounded-v1` and answers with `[S1]` /
 * `[S2: "quote"]` citations. Five free checks over the citations, kept off the findings.
 * Published: never edit. A change ships as `grounded-v2`.
 */

import { z } from 'zod'
import type { CaseInput } from '../contracts'
import { citationsOf, type CiteSegment } from '../grounded/citations'
import { containsRefusalV1, findQuoteV1, normalizeQuoteV1 } from '../grounded/match'
import { sourceList, type PromptSource } from '../grounded/sources'
import { LIMITS } from '../limits'
import { smallSampleCaveat } from './classification'
import type { CheckContext, CheckDefinition, CheckOutcome, CheckResult, KitMetric, KitReadinessIssue, TaskKit } from './types'

const G = LIMITS.grounded

/** The kit has no settings in v1; `{}` keeps the framework's settings slot (and its hash) explicit. */
export const groundedSettingsSchema = z.strictObject({})
export type GroundedSettings = z.infer<typeof groundedSettingsSchema>

const sourceNumber = z.number().int().min(1).max(G.sourcesPerQuestion.max)

/** A source's fingerprint on a question, written by the server from its table (never trusted from a client). */
export const sourceRefSchema = z.strictObject({
  number: sourceNumber,
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  byteLength: z.number().int().min(1),
})

export const ANSWERABLE = ['yes', 'partly', 'no'] as const
export type Answerable = (typeof ANSWERABLE)[number]

export const groundedFieldsSchema = z.strictObject({
  kind: z.literal('grounded'),
  /** The judge's grounding key (spec 05 §4.3): how far the sources answer the request. Shown to jurors, never sent to a party. */
  answerable: z.enum(ANSWERABLE),
  /** Sources a good answer must cite (S numbers). Empty when the answer is No. */
  requiredSources: z
    .array(sourceNumber)
    .max(G.sourcesPerQuestion.max)
    .refine((numbers) => new Set(numbers).size === numbers.length, 'Each required source once'),
  /**
   * The question's sources as the server recorded them (spec 05 §4.2), in order. Written from
   * `evaluation_sources` on every draft write, so the question and snapshot hashes commit to the
   * exact text. Never sent to a provider.
   */
  sources: z.array(sourceRefSchema).max(G.sourcesPerQuestion.max).optional(),
})
export type GroundedFields = z.infer<typeof groundedFieldsSchema>

export const GROUNDED_DEFAULT_FIELDS: GroundedFields = { kind: 'grounded', answerable: 'yes', requiredSources: [] }

type Check = CheckDefinition<GroundedSettings, GroundedFields>
type Ctx = CheckContext<GroundedSettings, GroundedFields>

/** The question's sources; a check without them is a fault in Model Court (the runner makes it an `error`). */
function sourcesOf(ctx: Ctx): ReadonlyArray<PromptSource> {
  const sources = ctx.materials?.sources
  if (!sources || sources.length === 0) throw new Error('grounded check without sources')
  return sources
}

function answerableOf(ctx: Ctx): Answerable {
  return ctx.fields?.answerable ?? 'yes'
}

function isReal(number: number, count: number): boolean {
  return number >= 1 && number <= count
}

function uniqueSorted(numbers: Iterable<number>): number[] {
  return [...new Set(numbers)].sort((a, b) => a - b)
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function range(count: number): string {
  return count === 1 ? 'S1' : `S1–S${count}`
}

const citesSomething: Check = {
  id: 'cites-something',
  label: 'Cites a source',
  description: 'The answer has at least one citation in the [S1] format to a source the question has. Other styles ("Source 2", footnotes, links) are not counted. Not applicable when the judge marked the question unanswerable.',
  run: (ctx): CheckOutcome => {
    if (answerableOf(ctx) === 'no') return { status: 'na', reason: 'The judge marked this question as not answerable from the sources.' }
    const count = sourcesOf(ctx).length
    const cites = citationsOf(ctx.testimony.text)
    const real = cites.filter((cite) => cite.sources.some((n) => isReal(n, count)))
    const detail = { citations: cites.length, toRealSources: real.length }
    if (real.length > 0) return { status: 'pass', reason: `${plural(real.length, 'citation', 'citations')} to the sources.`, detail }
    if (cites.length > 0) return { status: 'fail', reason: `Cites only ${sourceList(uniqueSorted(cites.flatMap((cite) => cite.sources)))}, which this question doesn't have.`, detail }
    return { status: 'fail', reason: 'No citation in the [S1] format.', detail }
  },
}

const citationsExist: Check = {
  id: 'citations-exist',
  label: 'Citations point to real sources',
  description: 'Every cited number is one of the question\'s sources (S1 to Sn).',
  run: (ctx): CheckOutcome => {
    const count = sourcesOf(ctx).length
    const cites = citationsOf(ctx.testimony.text)
    if (cites.length === 0) return { status: 'na', reason: 'No citations.' }
    const unknown = uniqueSorted(cites.flatMap((cite) => cite.sources.filter((n) => !isReal(n, count))))
    if (unknown.length === 0) return { status: 'pass', reason: `Every citation points to ${range(count)}.`, detail: { unknown: [] } }
    return { status: 'fail', reason: `Cites ${sourceList(unknown)}; this question has ${plural(count, 'source', 'sources')}.`, detail: { unknown } }
  },
}

function quoteMiss(cite: CiteSegment, count: number): string {
  const real = uniqueSorted(cite.sources.filter((n) => isReal(n, count)))
  const cited = sourceList(uniqueSorted(cite.sources))
  if (real.length === 0) return `the quote cited to ${cited} points to no source`
  if (real.length === 1) return `the quote cited to ${cited} is not in ${sourceList(real)}`
  return `the quote cited to ${cited} is in none of them`
}

const quotesMatch: Check = {
  id: 'quotes-match',
  label: 'Quotes match their sources',
  description: 'Every quote [S2: "…"] appears in (one of) its cited sources, ignoring case, spacing, curly quotes, dashes and markdown emphasis; "..." may skip words, the parts in order.',
  run: (ctx): CheckOutcome => {
    const sources = sourcesOf(ctx)
    const quotes = citationsOf(ctx.testimony.text).filter((cite) => cite.quote !== null)
    if (quotes.length === 0) return { status: 'na', reason: 'No quotes.' }
    const normalized = sources.map((source) => normalizeQuoteV1(source.text))
    const missing: number[] = []
    quotes.forEach((cite, index) => {
      const found = cite.sources.some((n) => isReal(n, sources.length) && findQuoteV1(normalized[n - 1], cite.quote!) !== null)
      if (!found) missing.push(index + 1)
    })
    const detail = { quotes: quotes.length, found: quotes.length - missing.length, missing }
    if (missing.length === 0) return { status: 'pass', reason: quotes.length === 1 ? 'The quote was found in its source.' : `All ${quotes.length} quotes were found in their sources.`, detail }
    const first = quoteMiss(quotes[missing[0] - 1], sources.length)
    const more = missing.length > 1 ? ` (and ${plural(missing.length - 1, 'other', 'others')})` : ''
    return { status: 'fail', reason: `${quotes.length - missing.length} of ${plural(quotes.length, 'quote', 'quotes')} found; ${first}${more}.`, detail }
  },
}

const requiredCited: Check = {
  id: 'required-cited',
  label: 'Required sources cited',
  description: 'Every source the judge marked under "A good answer cites" is cited at least once. Not applicable when there are none or the question is unanswerable.',
  run: (ctx): CheckOutcome => {
    sourcesOf(ctx)
    const required = uniqueSorted(ctx.fields?.requiredSources ?? [])
    if (answerableOf(ctx) === 'no') return { status: 'na', reason: 'The judge marked this question as not answerable from the sources.' }
    if (required.length === 0) return { status: 'na', reason: 'No required sources for this question.' }
    const cited = new Set(citationsOf(ctx.testimony.text).flatMap((cite) => cite.sources))
    const missing = required.filter((n) => !cited.has(n))
    const detail = { required, missing }
    if (missing.length === 0) return { status: 'pass', reason: `Cites every required source (${sourceList(required)}).`, detail }
    return { status: 'fail', reason: `${sourceList(missing)} ${missing.length === 1 ? 'is' : 'are'} required and not cited.`, detail }
  },
}

const refusal: Check = {
  id: 'refusal',
  label: 'Refuses only when it should',
  description: 'Unanswerable: the answer contains the sentence "The sources do not contain the answer." Answerable: it does not. A paraphrase is not recognized; the jury judges it. Not applicable when the sources answer in part.',
  run: (ctx): CheckOutcome => {
    sourcesOf(ctx)
    const answerable = answerableOf(ctx)
    const refused = containsRefusalV1(ctx.testimony.text)
    const detail = { refused }
    if (answerable === 'partly') return { status: 'na', reason: 'The judge marked the sources as answering in part; the jury judges what is missing.', detail }
    if (answerable === 'no') {
      return refused
        ? { status: 'pass', reason: 'Says the sources do not contain the answer.', detail }
        : { status: 'fail', reason: 'The fixed sentence was not found; a paraphrase may still be a correct refusal.', detail }
    }
    return refused
      ? { status: 'fail', reason: 'Says the sources do not contain the answer, but the judge marked them as answering it.', detail }
      : { status: 'pass', reason: 'Answers without saying the sources lack the answer.', detail }
  },
}

const CHECKS = [citesSomething, citationsExist, quotesMatch, requiredCited, refusal] as const

function resultOf(results: readonly CheckResult[], id: string): CheckResult | undefined {
  return results.find((result) => result.checkId === id)
}

function rate(rows: ReadonlyArray<{ results: CheckResult[] }>, id: string) {
  const decided = rows.map((row) => resultOf(row.results, id)).filter((result) => result && (result.status === 'pass' || result.status === 'fail'))
  return decided.length === 0 ? null : { numerator: decided.filter((result) => result!.status === 'pass').length, denominator: decided.length }
}

function fieldsOf(testCase: Pick<CaseInput, 'kitFields'>): GroundedFields | undefined {
  const fields = testCase.kitFields as GroundedFields | undefined
  return fields?.kind === 'grounded' ? fields : undefined
}

export const GROUNDED_V1: TaskKit<GroundedSettings, GroundedFields> = {
  version: 'grounded-v1',
  family: 'grounded',
  name: 'Answers from sources',
  description: 'Answers from numbered passages your retriever returned, with citations and quotes checked against them; jurors judge faithfulness and refusals.',
  listed: true,
  inputKinds: ['sources'],
  outputContract: { kind: 'text' },
  settingsSchema: groundedSettingsSchema,
  caseFieldsSchema: groundedFieldsSchema,
  defaultSettings: {},
  draftIssues: (_settings, cases: ReadonlyArray<CaseInput>) =>
    cases.flatMap((testCase, index) => {
      const issues: Array<{ path: (string | number)[]; message: string }> = []
      if (testCase.reference !== '') issues.push({ path: ['cases', index, 'reference'], message: 'A question answered from sources keeps its evidence in the sources, not the exhibit. Clear the exhibit.' })
      if (testCase.messages !== undefined) issues.push({ path: ['cases', index, 'messages'], message: "A question answered from sources can't carry a conversation." })
      const fields = fieldsOf(testCase)
      if (fields?.answerable === 'no' && fields.requiredSources.length > 0) issues.push({ path: ['cases', index, 'kitFields', 'requiredSources'], message: 'A question the sources cannot answer has no required sources.' })
      return issues
    }),
  // Spec 05 §4.4: every question needs sources, and every required source must still exist.
  readinessIssues: (_settings, cases): KitReadinessIssue[] =>
    cases.flatMap((testCase): KitReadinessIssue[] => {
      const fields = fieldsOf(testCase)
      const count = fields?.sources?.length ?? 0
      if (count === 0) return [{ kind: 'kit_sources_missing' as const, caseKey: testCase.key, kitVersion: 'grounded-v1' }]
      return (fields?.requiredSources ?? []).filter((n) => n > count).map((number) => ({ kind: 'kit_required_source_unknown' as const, caseKey: testCase.key, kitVersion: 'grounded-v1', number }))
    }),
  selectTemplate: () => 'grounded-v1',
  defaultRubricVersion: 'grounded-v1',
  defaultJuryInstructions: 'Check each claim against the source it cites. A claim the cited source does not support is not grounded, even if it is true.',
  checks: CHECKS,
  metrics: ({ rows, configurationKeys }): KitMetric[] => {
    const own = (key: string) => rows.filter((row) => row.configurationKey === key)
    return CHECKS.map((check) => {
      const decidedCases = new Set(rows.filter((row) => { const result = resultOf(row.results, check.id); return result?.status === 'pass' || result?.status === 'fail' }).map((row) => row.caseKey)).size
      return { id: check.id, label: check.label, byConfiguration: Object.fromEntries(configurationKeys.map((key) => [key, rate(own(key), check.id)])), caveat: smallSampleCaveat(decidedCases) }
    })
  },
  jurorCaseView: (_settings, fields) => ({
    kind: 'grounded',
    answerable: fields?.answerable ?? 'yes',
    requiredSources: uniqueSorted(fields?.requiredSources ?? []),
  }),
}
