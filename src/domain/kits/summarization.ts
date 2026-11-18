/**
 * `summarization-v1` (spec 03 §5, D-77): compare how setups summarize a document for a stated
 * reader. The exhibit (`reference`) is the document, `input` the request. Five free checks; the
 * phrase checks are a cheap proxy, and faithfulness and real coverage stay with the jury.
 * Published: never edit. A change ships as `summarization-v2`.
 */

import { z } from 'zod'
import type { CaseInput } from '../contracts'
import { LIMITS } from '../limits'
import { codePointLength, hasDisallowedControlChars } from '../text'
import { containsNormalizedV1, countCharactersV1, countWordsV1, extractNumbersV1, normalizeForMatchV1, splitLinesV1 } from './text'
import type { CheckDefinition, KitMetric, KitReadinessIssue, TaskKit } from './types'

const K = LIMITS.kits

/** A judge-supplied match phrase: trimmed, 1–60 characters, no control characters, at least one letter or digit. */
export const phraseSchema = z
  .string()
  .trim()
  .refine((value) => codePointLength(value) >= K.phrase.min && codePointLength(value) <= K.phrase.max, `A phrase must be ${K.phrase.min}–${K.phrase.max} characters`)
  .refine((value) => !hasDisallowedControlChars(value) && !/[\r\n\t]/u.test(value), 'A phrase must be one line')
  .refine((value) => /[\p{L}\p{N}]/u.test(value), 'A phrase needs at least one letter or digit')

export const summarizationSettingsSchema = z
  .strictObject({
    lengthUnit: z.enum(['words', 'characters']),
    maxLength: z.number().int().min(1),
    minLength: z.number().int().min(0).optional(),
    format: z.enum(['any', 'paragraph', 'bullets']),
    checkNumbers: z.boolean(),
  })
  .superRefine((settings, ctx) => {
    const cap = settings.lengthUnit === 'words' ? K.summaryMaxWords : K.summaryMaxCharacters
    if (settings.maxLength > cap) ctx.addIssue({ code: 'custom', path: ['maxLength'], message: `At most ${cap.toLocaleString('en-US')} ${settings.lengthUnit}, so a summary within the limit fits the answer length cap` })
    if (settings.minLength !== undefined && settings.minLength > settings.maxLength) ctx.addIssue({ code: 'custom', path: ['minLength'], message: 'The minimum cannot be above the maximum' })
  })
export type SummarizationSettings = z.infer<typeof summarizationSettingsSchema>

export const summarizationFieldsSchema = z.strictObject({
  kind: z.literal('summarization'),
  /** Points the summary must mention. A point counts when any of its phrases appears. */
  requiredPoints: z
    .array(
      z.strictObject({
        text: z.string().trim().refine((value) => codePointLength(value) >= K.requiredPointText.min && codePointLength(value) <= K.requiredPointText.max, `A point must be ${K.requiredPointText.min}–${K.requiredPointText.max} characters`),
        anyOf: z.array(phraseSchema).min(1, 'Give at least one phrase that shows the point is covered').max(K.phrasesPerPoint, `At most ${K.phrasesPerPoint} phrases per point`),
      }),
    )
    .max(K.requiredPoints, `At most ${K.requiredPoints} required points`),
  /** Phrases the summary must not contain (a name to keep private, a claim not in the document). */
  mustNotMention: z.array(phraseSchema).max(K.mustNotMention, `At most ${K.mustNotMention} phrases`),
})
export type SummarizationFields = z.infer<typeof summarizationFieldsSchema>

export const SUMMARIZATION_DEFAULT_SETTINGS: SummarizationSettings = { lengthUnit: 'words', maxLength: 100, format: 'any', checkNumbers: true }

function unitWord(unit: SummarizationSettings['lengthUnit'], count: number): string {
  return unit === 'words' ? (count === 1 ? 'word' : 'words') : count === 1 ? 'character' : 'characters'
}

/** "100 words or fewer", or "Between 40 and 100 words". */
export function lengthLimitText(settings: SummarizationSettings): string {
  const unit = unitWord(settings.lengthUnit, settings.maxLength)
  if (settings.minLength) return `Between ${settings.minLength.toLocaleString('en-US')} and ${settings.maxLength.toLocaleString('en-US')} ${unit}`
  return `${settings.maxLength.toLocaleString('en-US')} ${unit} or fewer`
}

export function summaryLength(text: string, unit: SummarizationSettings['lengthUnit']): number {
  return unit === 'words' ? countWordsV1(text) : countCharactersV1(text)
}

/** A bullet line: `-`, `*` or `•` then a space, or a number then `.` or `)` then a space. */
function isBulletLine(line: string): boolean {
  const first = line[0]
  if ((first === '-' || first === '*' || first === '•') && (line[1] === ' ' || line[1] === '\t')) return true
  let index = 0
  while (index < line.length && line[index] >= '0' && line[index] <= '9') index++
  return index > 0 && (line[index] === '.' || line[index] === ')') && (line[index + 1] === ' ' || line[index + 1] === '\t')
}

function quote(text: string): string {
  const chars = [...text]
  return `'${chars.length > 60 ? `${chars.slice(0, 59).join('')}…` : text}'`
}

type Check = CheckDefinition<SummarizationSettings, SummarizationFields>

const lengthCheck: Check = {
  id: 'length',
  label: 'Length within limit',
  description: 'Counts words (letters or digits between spaces; bullet dashes and list numbers are not words) or characters (excluding spaces) and compares them with the limit.',
  run: ({ testimony, settings }) => {
    const count = summaryLength(testimony.text, settings.lengthUnit)
    const n = (value: number) => value.toLocaleString('en-US')
    const unit = settings.lengthUnit
    const min = settings.minLength ?? 0
    const detail = { count, unit }
    if (count > settings.maxLength) return { status: 'fail', reason: `${n(count)} ${unitWord(unit, count)}; the limit is ${n(settings.maxLength)}.`, detail }
    if (count < min) return { status: 'fail', reason: `${n(count)} ${unitWord(unit, count)}; at least ${n(min)} expected.`, detail }
    return { status: 'pass', reason: `${n(count)} ${unitWord(unit, count)}; the limit is ${n(settings.maxLength)}.`, detail }
  },
}

const formatCheck: Check = {
  id: 'format',
  label: 'Follows the format',
  description: 'Bullets: at least two lines, each starting with "- ", "* ", "• " or a number like "1. ", after an optional heading ending in a colon. Paragraph: no line starts with a bullet marker.',
  run: ({ testimony, settings }) => {
    if (settings.format === 'any') return { status: 'na', reason: 'Any format is allowed.', detail: { line: null } }
    const lines = splitLinesV1(testimony.text).map((line, index) => ({ text: line.trim(), number: index + 1 })).filter((line) => line.text.length > 0)
    if (settings.format === 'paragraph') {
      const bullet = lines.find((line) => isBulletLine(line.text))
      return bullet ? { status: 'fail', reason: `Line ${bullet.number} starts with a bullet marker; a paragraph was asked for.`, detail: { line: bullet.number } } : { status: 'pass', reason: 'Written without bullet points.', detail: { line: null } }
    }
    const items = lines.length > 0 && lines[0].text.endsWith(':') && !isBulletLine(lines[0].text) ? lines.slice(1) : lines
    const offending = items.find((line) => !isBulletLine(line.text))
    if (offending) return { status: 'fail', reason: `Line ${offending.number} is not a bullet point.`, detail: { line: offending.number } }
    if (items.length < 2) return { status: 'fail', reason: `${items.length === 1 ? 'Only one bullet point' : 'No bullet points'}; at least two expected.`, detail: { line: null } }
    return { status: 'pass', reason: `${items.length} bullet points.`, detail: { line: null } }
  },
}

const requiredPointsCheck: Check = {
  id: 'required-points',
  label: 'Covers required points (by phrase)',
  description: 'A point counts as covered when any of its phrases appears as whole words (case, quotes and emphasis ignored). A cheap proxy: reworded coverage is missed, and a phrase can appear without the point being made.',
  run: ({ testimony, fields }) => {
    const points = fields?.requiredPoints ?? []
    if (points.length === 0) return { status: 'na', reason: 'No required points for this question.', detail: { matched: 0, total: 0, missing: [] } }
    const text = normalizeForMatchV1(testimony.text)
    const missing = points.flatMap((point, index) => (point.anyOf.some((phrase) => containsNormalizedV1(text, normalizeForMatchV1(phrase))) ? [] : [index + 1]))
    const detail = { matched: points.length - missing.length, total: points.length, missing }
    if (missing.length === 0) return { status: 'pass', reason: `Covers all ${points.length} required ${points.length === 1 ? 'point' : 'points'}.`, detail }
    return { status: 'fail', reason: `Missing ${missing.length} of ${points.length}: ${missing.map((n) => `(${n}) ${points[n - 1].text}`).join('; ')}.`, detail }
  },
}

const mustNotMentionCheck: Check = {
  id: 'must-not-mention',
  label: 'Avoids listed phrases',
  description: 'Fails when any listed phrase appears as whole words (case, quotes and emphasis ignored). A paraphrase of a listed phrase is not caught.',
  run: ({ testimony, fields }) => {
    const phrases = fields?.mustNotMention ?? []
    if (phrases.length === 0) return { status: 'na', reason: 'No phrases to avoid for this question.', detail: { found: [] } }
    const text = normalizeForMatchV1(testimony.text)
    const found = phrases.filter((phrase) => containsNormalizedV1(text, normalizeForMatchV1(phrase)))
    if (found.length === 0) return { status: 'pass', reason: `None of the ${phrases.length} listed ${phrases.length === 1 ? 'phrase appears' : 'phrases appear'}.`, detail: { found } }
    return { status: 'fail', reason: `Mentions ${found.map(quote).join(', ')}.`, detail: { found } }
  },
}

const numbersCheck: Check = {
  id: 'numbers-from-document',
  label: 'Numbers appear in the document',
  description: 'Every number in the summary should also appear in the document or the request. Blind spots: spelled-out numbers ("three"), dates written differently ("11/18" and "November 18"), and computed figures.',
  run: ({ testimony, testCase, settings }) => {
    if (!settings.checkNumbers) return { status: 'na', reason: 'The numbers check is off for this case.', detail: { unsupported: [] } }
    const numbers = [...new Set(extractNumbersV1(testimony.text))]
    if (numbers.length === 0) return { status: 'na', reason: 'The summary contains no numbers.', detail: { unsupported: [] } }
    const known = new Set([...extractNumbersV1(testCase.reference), ...extractNumbersV1(testCase.input)])
    const unsupported = numbers.filter((number) => !known.has(number))
    if (unsupported.length === 0) return { status: 'pass', reason: `All ${numbers.length} ${numbers.length === 1 ? 'number appears' : 'numbers appear'} in the document or the request.`, detail: { unsupported: [] } }
    const shown = unsupported.slice(0, 5)
    return { status: 'fail', reason: `Not in the document: ${shown.join(', ')}${unsupported.length > shown.length ? ` and ${unsupported.length - shown.length} more` : ''} (may be computed or reworded).`, detail: { unsupported: unsupported.slice(0, 20) } }
  },
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export const SUMMARIZATION_V1: TaskKit<SummarizationSettings, SummarizationFields> = {
  version: 'summarization-v1',
  family: 'summarization',
  name: 'Summaries',
  description: 'Summaries of a document for a stated reader, with length, format, required-point, phrase and number checks.',
  listed: true,
  inputKinds: ['text'],
  outputContract: { kind: 'text' },
  settingsSchema: summarizationSettingsSchema,
  caseFieldsSchema: summarizationFieldsSchema,
  defaultSettings: SUMMARIZATION_DEFAULT_SETTINGS,
  readinessIssues: (_settings, cases: ReadonlyArray<CaseInput>): KitReadinessIssue[] =>
    cases.filter((testCase) => testCase.reference.trim().length === 0).map((testCase) => ({ kind: 'kit_document_missing' as const, caseKey: testCase.key, kitVersion: 'summarization-v1' })),
  selectTemplate: () => 'summarize-v1',
  defaultRubricVersion: 'summary-v1',
  defaultJuryInstructions: 'A good summary is faithful to the document, covers the points listed below, and suits the reader named in the request.',
  checks: [lengthCheck, formatCheck, requiredPointsCheck, mustNotMentionCheck, numbersCheck],
  metrics: ({ settings, rows, configurationKeys }): KitMetric[] => {
    const values = Object.fromEntries(
      configurationKeys.map((key) => {
        const counts = rows.filter((row) => row.configurationKey === key).flatMap((row) => {
          const count = row.results.find((result) => result.checkId === 'length')?.detail.count
          return typeof count === 'number' ? [count] : []
        })
        return [key, medianOf(counts)]
      }),
    )
    return [{ id: 'median-length', label: 'Median length', byConfiguration: Object.fromEntries(configurationKeys.map((key) => [key, null])), values, unit: settings.lengthUnit, caveat: null }]
  },
  jurorCaseView: (settings, fields) => ({
    kind: 'summarization',
    lengthLimit: lengthLimitText(settings),
    format: settings.format === 'any' ? null : settings.format,
    requiredPoints: (fields?.requiredPoints ?? []).map((point) => point.text),
    mustNotMention: fields?.mustNotMention ?? [],
  }),
}
