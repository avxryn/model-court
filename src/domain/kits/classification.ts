/**
 * `classification-v1` (spec 03 §6, D-78): compare how setups put an item into one label from a
 * fixed set, and how well they justify it. `input` is the item, `reference` optional context.
 * Every party is asked for "Label: <label>" on the first line, reasoning after; the answer stays
 * plain text, so no adapter request changes. Published: never edit; ship `classification-v2`.
 */

import { z } from 'zod'
import type { CaseInput } from '../contracts'
import { LIMITS } from '../limits'
import { codePointLength, hasDisallowedControlChars } from '../text'
import { countWordsV1, normalizeLabelV1, splitLinesV1 } from './text'
import type { CheckDefinition, CheckResult, KitMetric, TaskKit } from './types'

const K = LIMITS.kits

/** A label as the judge writes it: trimmed, 1–40 characters, one line, not starting with "label:". */
export const labelSchema = z
  .string()
  .trim()
  .refine((value) => codePointLength(value) >= K.label.min && codePointLength(value) <= K.label.max, `A label must be ${K.label.min}–${K.label.max} characters`)
  .refine((value) => !hasDisallowedControlChars(value) && !/[\r\n\t]/u.test(value), 'A label must be one line')
  .refine((value) => normalizeLabelV1(value).length > 0, 'A label needs a letter or digit')
  .refine((value) => !/^label\s*:/iu.test(normalizeLabelV1(value)), 'A label cannot start with "Label:"')

export const classificationSettingsSchema = z
  .strictObject({
    labels: z.array(labelSchema).min(K.labels.min, `Give at least ${K.labels.min} labels`).max(K.labels.max, `At most ${K.labels.max} labels`),
    minReasoningWords: z.number().int().min(0).max(K.minReasoningWords),
  })
  .superRefine((settings, ctx) => {
    const seen = new Map<string, number>()
    settings.labels.forEach((label, index) => {
      const key = normalizeLabelV1(label)
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['labels', index], message: `"${label}" repeats label ${seen.get(key)! + 1} (labels are compared without case, quotes or a final period)` })
      else seen.set(key, index)
    })
  })
export type ClassificationSettings = z.infer<typeof classificationSettingsSchema>

export const classificationFieldsSchema = z.strictObject({
  kind: z.literal('classification'),
  /** The answer key. Optional: without it, label-correct does not apply to this question. */
  expectedLabel: labelSchema.optional(),
  /** Other labels that also count as correct, for genuinely ambiguous items. Requires expectedLabel. */
  alsoAccept: z.array(labelSchema).max(K.alsoAccept, `At most ${K.alsoAccept} other labels`).optional(),
})
export type ClassificationFields = z.infer<typeof classificationFieldsSchema>

export const CLASSIFICATION_DEFAULT_SETTINGS: ClassificationSettings = { labels: ['Yes', 'No'], minReasoningWords: 5 }

/** The allowed label a written label matches (compared normalized), or null. */
export function canonicalLabel(labels: readonly string[], value: string): string | null {
  const key = normalizeLabelV1(value)
  const matches = labels.filter((label) => normalizeLabelV1(label) === key)
  return matches.length === 1 ? matches[0] : null
}

const LABEL_PREFIX = /^label\s*:/iu
const EMPHASIS = new Set(['*', '_', '`', '"', "'", '‘', '’', '“', '”'])

/**
 * v1 parsing (spec 03 §6.4): the first non-empty line, emphasis, backticks and quotes removed,
 * an optional "Label:" prefix dropped, then compared whole with every allowed label. "Billing or
 * Bug", "Billing, Bug" and a label that is only a prefix of another never match by accident.
 */
export function parseLabelV1(text: string, labels: readonly string[]): { predicted: string | null; firstLine: string; reasoning: string } {
  const lines = splitLinesV1(text)
  const index = lines.findIndex((line) => line.trim().length > 0)
  if (index < 0) return { predicted: null, firstLine: '', reasoning: '' }
  const firstLine = lines[index].trim()
  let candidate = ''
  for (const char of firstLine) if (!EMPHASIS.has(char)) candidate += char
  candidate = candidate.trim()
  if (LABEL_PREFIX.test(candidate)) candidate = candidate.slice(candidate.indexOf(':') + 1)
  return { predicted: candidate.trim() ? canonicalLabel(labels, candidate) : null, firstLine, reasoning: lines.slice(index + 1).join('\n') }
}

function quote(text: string): string {
  const chars = [...text]
  return `'${chars.length > 60 ? `${chars.slice(0, 59).join('')}…` : text}'`
}

type Check = CheckDefinition<ClassificationSettings, ClassificationFields>

const labelFormatCheck: Check = {
  id: 'label-format',
  label: 'Names one allowed label',
  description: 'The first line must name exactly one allowed label, as "Label: <label>" or the label alone (case, quotes, emphasis and a final period ignored).',
  run: ({ testimony, settings }) => {
    const { predicted, firstLine } = parseLabelV1(testimony.text, settings.labels)
    if (predicted) return { status: 'pass', reason: `Names ${predicted}.`, detail: { predicted } }
    return { status: 'fail', reason: firstLine ? `The first line, ${quote(firstLine)}, names no allowed label.` : 'The answer is empty.', detail: { predicted: null } }
  },
}

const labelCorrectCheck: Check = {
  id: 'label-correct',
  label: 'Matches the expected label',
  description: "Compares the label on the first line with the judge's answer key and any other accepted labels.",
  run: ({ testimony, settings, fields }) => {
    const expected = fields?.expectedLabel ? (canonicalLabel(settings.labels, fields.expectedLabel) ?? fields.expectedLabel) : null
    if (!expected) return { status: 'na', reason: 'No expected label for this question.', detail: { expected: null, predicted: null } }
    const { predicted } = parseLabelV1(testimony.text, settings.labels)
    const accepted = new Set([expected, ...(fields?.alsoAccept ?? []).map((label) => canonicalLabel(settings.labels, label) ?? label)])
    if (!predicted) return { status: 'fail', reason: `No allowed label, so it cannot match ${expected}.`, detail: { expected, predicted: null } }
    if (accepted.has(predicted)) return { status: 'pass', reason: predicted === expected ? `Said ${predicted}, the expected label.` : `Said ${predicted}, which is also accepted (expected ${expected}).`, detail: { expected, predicted } }
    return { status: 'fail', reason: `Said ${predicted}; the expected label is ${expected}.`, detail: { expected, predicted } }
  },
}

const reasoningCheck: Check = {
  id: 'reasoning-given',
  label: 'Gives reasoning',
  description: 'Counts the words after the label line. It measures that reasoning is there, not that it is sound: that is for the jury.',
  run: ({ testimony, settings }) => {
    if (settings.minReasoningWords === 0) return { status: 'na', reason: 'The reasoning check is off for this case.', detail: { words: 0 } }
    const words = countWordsV1(parseLabelV1(testimony.text, settings.labels).reasoning)
    const noun = words === 1 ? 'word' : 'words'
    if (words >= settings.minReasoningWords) return { status: 'pass', reason: `${words} ${noun} of reasoning.`, detail: { words } }
    return { status: 'fail', reason: `${words} ${noun} of reasoning; at least ${settings.minReasoningWords} expected.`, detail: { words } }
  },
}

/** "On 5 questions; one question moves this by 20 percentage points. A small sample, not a benchmark." */
export function smallSampleCaveat(denominator: number): string | null {
  if (denominator === 0 || denominator >= 10) return null
  const points = Math.round(100 / denominator)
  return `On ${denominator} ${denominator === 1 ? 'question' : 'questions'}; one question moves this by ${points} percentage points. A small sample, not a benchmark.`
}

function resultOf(results: readonly CheckResult[], id: string): CheckResult | undefined {
  return results.find((result) => result.checkId === id)
}

export const CLASSIFICATION_V1: TaskKit<ClassificationSettings, ClassificationFields> = {
  version: 'classification-v1',
  family: 'classification',
  name: 'Classification',
  description: 'One label from a fixed set per item, with reasoning: label format, accuracy against your answer key, and reasoning length.',
  listed: true,
  inputKinds: ['text'],
  outputContract: { kind: 'label', format: 'first-line-v1' },
  settingsSchema: classificationSettingsSchema,
  caseFieldsSchema: classificationFieldsSchema,
  defaultSettings: CLASSIFICATION_DEFAULT_SETTINGS,
  draftIssues: (settings, cases: ReadonlyArray<CaseInput>) =>
    cases.flatMap((testCase, index) => {
      const fields = testCase.kitFields as ClassificationFields | undefined
      if (!fields || fields.kind !== 'classification') return []
      const path = (...rest: (string | number)[]) => ['cases', index, 'kitFields', ...rest]
      const issues: Array<{ path: (string | number)[]; message: string }> = []
      if (fields.expectedLabel !== undefined && !canonicalLabel(settings.labels, fields.expectedLabel)) issues.push({ path: path('expectedLabel'), message: `"${fields.expectedLabel}" is not one of the labels` })
      const also = fields.alsoAccept ?? []
      if (also.length > 0 && fields.expectedLabel === undefined) issues.push({ path: path('alsoAccept'), message: 'Other accepted labels need an expected label' })
      const seen = new Set<string>(fields.expectedLabel !== undefined ? [normalizeLabelV1(fields.expectedLabel)] : [])
      also.forEach((label, i) => {
        if (!canonicalLabel(settings.labels, label)) issues.push({ path: path('alsoAccept', i), message: `"${label}" is not one of the labels` })
        else if (seen.has(normalizeLabelV1(label))) issues.push({ path: path('alsoAccept', i), message: `"${label}" is already accepted` })
        seen.add(normalizeLabelV1(label))
      })
      return issues
    }),
  selectTemplate: () => 'classify-v1',
  defaultRubricVersion: 'classification-v1',
  defaultJuryInstructions: "Judge whether the reasoning supports the label and rests on what the item actually says. The expected label, if given, is the judge's answer key.",
  checks: [labelFormatCheck, labelCorrectCheck, reasoningCheck],
  metrics: ({ rows, configurationKeys }): KitMetric[] => {
    const own = (key: string) => rows.filter((row) => row.configurationKey === key)
    const accuracy = Object.fromEntries(
      configurationKeys.map((key) => {
        const keyed = own(key).map((row) => resultOf(row.results, 'label-correct')).filter((result) => result && (result.status === 'pass' || result.status === 'fail'))
        return [key, keyed.length === 0 ? null : { numerator: keyed.filter((result) => result!.status === 'pass').length, denominator: keyed.length }]
      }),
    )
    const denominators = Object.values(accuracy).flatMap((value) => (value ? [value.denominator] : []))
    const invalid = Object.fromEntries(
      configurationKeys.map((key) => {
        const formats = own(key).map((row) => resultOf(row.results, 'label-format')).filter((result) => result && result.status !== 'error')
        return [key, formats.length === 0 ? null : { numerator: formats.filter((result) => result!.status === 'fail').length, denominator: formats.length }]
      }),
    )
    return [
      { id: 'accuracy', label: 'Matched the expected label', byConfiguration: accuracy, caveat: smallSampleCaveat(denominators.length ? Math.max(...denominators) : 0) },
      { id: 'invalid-labels', label: 'Answers without an allowed label', byConfiguration: invalid, caveat: null },
    ]
  },
  jurorCaseView: (settings, fields) => ({
    kind: 'classification',
    labels: settings.labels,
    expectedLabel: fields?.expectedLabel ? (canonicalLabel(settings.labels, fields.expectedLabel) ?? fields.expectedLabel) : null,
    alsoAccept: fields?.alsoAccept ?? [],
  }),
  consistencyKey: (results) => {
    const predicted = resultOf(results, 'label-format')?.detail.predicted
    return typeof predicted === 'string' ? predicted : null
  },
}
