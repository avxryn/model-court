/**
 * `extraction-v1` (spec 04, D-85): compare how setups pull fields out of a document into JSON.
 * The judge's field list (an authoring schema) and comparison rules are the kit settings; each
 * question's answer key is its kit field. The document lives outside the draft (spec 04 §4.2),
 * and every party answers through its provider's structured-output mode with the compiled wire
 * schema. Four free checks: valid JSON, fits the field list, must-fill fields filled, and the
 * answer key. Published: never edit. A change ships as `extraction-v2`.
 */

import { z } from 'zod'
import type { CaseInput } from '../contracts'
import { compareRulesSchema, compareToAnswerKey, validateCompareRules, type CompareRules } from '../extraction/compare'
import { parseOutput } from '../extraction/render'
import { isOptional, leafFields, validateAuthoringSchema, type ExtractionSchema, type FieldPath, type SchemaNode } from '../extraction/schema'
import { capitalizationDifferences, validateAgainstSchema } from '../extraction/validate'
import { LIMITS } from '../limits'
import { canonicalJson } from '../canonical'
import { utf8ByteLength } from '../text'
import { smallSampleCaveat } from './classification'
import type { CheckDefinition, CheckOutcome, CheckResult, KitMetric, TaskKit } from './types'

const X = LIMITS.extraction

/** A schema pointer (`/properties/total/minimum`) as a Zod issue path. */
function pointerPath(pointer: string): string[] {
  return pointer === '' ? [] : pointer.split('/').slice(1).map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

const jsonObject = z.record(z.string(), z.unknown())

export interface ExtractionSettings {
  schema: ExtractionSchema
  compare: CompareRules
}

export const extractionSettingsSchema = z
  .strictObject({
    /** The judge's field list, in the portable subset (spec 04 §7.2). */
    schema: jsonObject,
    /** Per-field comparison overrides, keyed by field pattern (spec 04 §9.4). */
    compare: compareRulesSchema,
  })
  .superRefine((settings, ctx) => {
    const result = validateAuthoringSchema(settings.schema)
    if (!result.ok) {
      for (const issue of result.issues) ctx.addIssue({ code: 'custom', path: ['schema', ...pointerPath(issue.path)], message: issue.message })
      return
    }
    for (const issue of validateCompareRules(result.schema, settings.compare)) ctx.addIssue({ code: 'custom', path: ['compare', issue.path], message: issue.message })
  }) as unknown as z.ZodType<ExtractionSettings>

export const extractionFieldsSchema = z.strictObject({
  kind: z.literal('extraction'),
  /**
   * The judge's answer key (spec 04 §9.5). Optional; never sent to a provider and hidden from
   * jurors until unsealing (decision 1). Write null for a May-be-empty field the document
   * doesn't have, so invented values can be counted; leave a field out to not compare it.
   */
  answerKey: jsonObject.refine((value) => {
    try {
      return utf8ByteLength(canonicalJson(value)) <= X.answerKeyBytes
    } catch {
      return false
    }
  }, `An answer key is at most ${X.answerKeyBytes / 1024} KiB`).optional(),
})
export type ExtractionFields = z.infer<typeof extractionFieldsSchema>

export const EXTRACTION_DEFAULT_SETTINGS: ExtractionSettings = {
  schema: { type: 'object', properties: { name: { type: 'string', title: 'Name' } }, required: ['name'] },
  compare: {},
}

/** The default request (`input`) of a new extraction question. */
export const EXTRACTION_DEFAULT_INPUT = 'Extract the fields from the document.'

/** Whether the JSON text ends inside an object, array or string (likely cut off at the output limit). */
export function endsIncomplete(text: string): boolean {
  let depth = 0
  let inString = false
  let escaped = false
  for (const char of text.trim()) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
  }
  return inString || depth > 0
}

function blankRequired(schema: ExtractionSchema, value: unknown): FieldPath[] {
  const out: FieldPath[] = []
  const visit = (node: SchemaNode, current: unknown, path: FieldPath) => {
    if (node.type === 'object' && current !== null && typeof current === 'object' && !Array.isArray(current)) {
      for (const [name, child] of Object.entries(node.properties)) {
        const childValue = Object.hasOwn(current, name) ? (current as Record<string, unknown>)[name] : undefined
        const childPath = `${path}/${name}`
        if (!isOptional(node, name)) {
          if (childValue === null || childValue === undefined) out.push(childPath)
          else if (child.type === 'string' && typeof childValue === 'string' && childValue.trim() === '') out.push(childPath)
          else if (child.type === 'array' && Array.isArray(childValue) && childValue.length === 0) out.push(childPath)
        }
        visit(child, childValue, childPath)
      }
    } else if (node.type === 'array' && Array.isArray(current) && node.items.type === 'object') {
      current.forEach((item, index) => visit(node.items, item, `${path}/${index}`))
    }
  }
  visit(schema, value, '')
  return out
}

function hasRequiredField(node: SchemaNode): boolean {
  if (node.type === 'object') return (node.required ?? []).length > 0 || Object.values(node.properties).some(hasRequiredField)
  if (node.type === 'array') return hasRequiredField(node.items)
  return false
}

function listPaths(paths: readonly string[], max = 3): string {
  const shown = paths.slice(0, max).join(', ')
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown
}

const NO_JSON = 'No JSON to check.'

type Check = CheckDefinition<ExtractionSettings, ExtractionFields>

const parseCheck: Check = {
  id: 'json-parse',
  label: 'Valid JSON',
  description: 'The whole answer, trimmed, must be one JSON value. Nothing is repaired: a code fence or a sentence around the JSON fails.',
  run: ({ testimony }): CheckOutcome => {
    const parsed = parseOutput(testimony.text)
    if (parsed.status === 'parsed') return { status: 'pass', reason: 'The answer is valid JSON.' }
    const trimmed = testimony.text.trim()
    if (trimmed.startsWith('```')) return { status: 'fail', reason: 'Not JSON: the answer is wrapped in a code fence.' }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      if (endsIncomplete(trimmed)) return { status: 'fail', reason: 'The JSON ends before it is complete (it may have been cut off at the output limit).' }
      return { status: 'fail', reason: 'Not JSON: the text starts like JSON but does not parse.' }
    }
    return { status: 'fail', reason: 'Not JSON: the answer starts with text.' }
  },
}

const schemaCheck: Check = {
  id: 'json-schema',
  label: 'Fits the field list',
  description: 'Every field present with the right type, allowed value and format, no extra fields, and empty only where the field may be empty. Capitalization of an allowed value is noted, not failed.',
  run: ({ testimony, settings }): CheckOutcome => {
    const parsed = parseOutput(testimony.text)
    if (parsed.status !== 'parsed') return { status: 'na', reason: NO_JSON }
    const issues = validateAgainstSchema(settings.schema, parsed.value, 'output')
    if (issues.length > 0) {
      const reason = issues.slice(0, 3).map((issue) => `${issue.path || '(the answer)'}: ${issue.problem}`).join('; ')
      return { status: 'fail', reason: issues.length > 3 ? `${reason}; and ${issues.length - 3} more.` : `${reason}.`, detail: { errors: issues.length, paths: issues.map((issue) => issue.path) } }
    }
    const casing = capitalizationDifferences(settings.schema, parsed.value)
    if (casing.length > 0) return { status: 'pass', reason: `Fits the field list; capitalization differs at ${listPaths(casing)}.`, detail: { errors: 0, capitalization: casing.slice(0, 10) } }
    return { status: 'pass', reason: 'Fits the field list.', detail: { errors: 0 } }
  },
}

const requiredCheck: Check = {
  id: 'required-filled',
  label: 'Must-fill fields filled',
  description: 'Every field marked Must be filled has a value: text that is not blank, a list with at least one item.',
  run: ({ testimony, settings }): CheckOutcome => {
    if (!hasRequiredField(settings.schema)) return { status: 'na', reason: 'No field is marked Must be filled.' }
    const parsed = parseOutput(testimony.text)
    if (parsed.status !== 'parsed') return { status: 'na', reason: NO_JSON }
    const blank = blankRequired(settings.schema, parsed.value)
    if (blank.length === 0) return { status: 'pass', reason: 'Every must-fill field is filled.', detail: { blank: 0 } }
    return { status: 'fail', reason: `${listPaths(blank)} ${blank.length === 1 ? 'is' : 'are'} empty.`, detail: { blank: blank.length, paths: blank.slice(0, 10) } }
  },
}

const answerKeyCheck: Check = {
  id: 'answer-key',
  label: 'Matches the answer key',
  description: "Compares each field with the judge's answer key under its comparison rule. A value where the key says the document has none counts as invented.",
  run: ({ testimony, settings, fields }): CheckOutcome => {
    if (!fields?.answerKey) return { status: 'na', reason: 'No answer key for this question.' }
    const parsed = parseOutput(testimony.text)
    if (parsed.status !== 'parsed') return { status: 'na', reason: NO_JSON }
    const { counts } = compareToAnswerKey(settings.schema, settings.compare, fields.answerKey, parsed.value)
    const detail = { compared: counts.compared, matched: counts.match, mismatched: counts.mismatch, missed: counts.missed, invented: counts.invented }
    if (counts.compared === 0 && counts.invented === 0) return { status: 'na', reason: 'The answer key compares no field.', detail }
    const extras = [counts.mismatch > 0 ? `${counts.mismatch} wrong` : '', counts.invented > 0 ? `${counts.invented} invented` : '', counts.missed > 0 ? `${counts.missed} missed` : ''].filter(Boolean)
    const head = `${counts.match} of ${counts.compared} match`
    if (extras.length === 0) return { status: 'pass', reason: `${head}.`, detail }
    return { status: 'fail', reason: `${head}; ${extras.join(', ')}.`, detail }
  },
}

function resultOf(results: readonly CheckResult[], id: string): CheckResult | undefined {
  return results.find((result) => result.checkId === id)
}

function rate(rows: ReadonlyArray<{ results: CheckResult[] }>, id: string) {
  const decided = rows.map((row) => resultOf(row.results, id)).filter((result) => result && (result.status === 'pass' || result.status === 'fail'))
  return decided.length === 0 ? null : { numerator: decided.filter((result) => result!.status === 'pass').length, denominator: decided.length }
}

function detailSum(rows: ReadonlyArray<{ results: CheckResult[] }>, key: string): { total: number; seen: boolean } {
  let total = 0
  let seen = false
  for (const row of rows) {
    const result = resultOf(row.results, 'answer-key')
    const value = result?.detail[key]
    if (typeof value === 'number') {
      total += value
      seen = true
    }
  }
  return { total, seen }
}

export const EXTRACTION_V1: TaskKit<ExtractionSettings, ExtractionFields> = {
  version: 'extraction-v1',
  family: 'extraction',
  name: 'Pull fields from documents',
  description: 'Fields from a document as JSON, checked against your field list and answer key; jurors mark invented values.',
  // Unlisted until the text path works end to end (spec 04 step A4); listed from then on.
  listed: false,
  inputKinds: ['document'],
  outputContract: { kind: 'json', schemaSource: 'kit-settings' },
  settingsSchema: extractionSettingsSchema,
  caseFieldsSchema: extractionFieldsSchema,
  defaultSettings: EXTRACTION_DEFAULT_SETTINGS,
  draftIssues: (settings, cases: ReadonlyArray<CaseInput>) => {
    const valid = validateAuthoringSchema(settings.schema)
    return cases.flatMap((testCase, index) => {
      const issues: Array<{ path: (string | number)[]; message: string }> = []
      if (testCase.reference !== '') issues.push({ path: ['cases', index, 'reference'], message: 'A field-extraction question keeps its source in the document, not the exhibit. Clear the exhibit.' })
      if (testCase.messages !== undefined) issues.push({ path: ['cases', index, 'messages'], message: "A field-extraction question can't carry a conversation." })
      const fields = testCase.kitFields as ExtractionFields | undefined
      if (valid.ok && fields?.kind === 'extraction' && fields.answerKey !== undefined) {
        for (const issue of validateAgainstSchema(valid.schema, fields.answerKey, 'answerKey')) {
          issues.push({ path: ['cases', index, 'kitFields', 'answerKey', ...pointerPath(issue.path)], message: `Answer key ${issue.path || ''}: ${issue.problem}`.replace(' :', ':') })
        }
      }
      return issues
    })
  },
  selectTemplate: () => 'extract-v1',
  defaultRubricVersion: 'extraction-v1',
  defaultJuryInstructions: "Check each value against the document. Mark a value Invented if the document doesn't support it, Ambiguous if the document could fairly be read another way.",
  checks: [parseCheck, schemaCheck, requiredCheck, answerKeyCheck],
  metrics: ({ rows, configurationKeys }): KitMetric[] => {
    const own = (key: string) => rows.filter((row) => row.configurationKey === key)
    const accuracy: KitMetric['byConfiguration'] = {}
    const invented: Record<string, number | null> = {}
    const missed: Record<string, number | null> = {}
    for (const key of configurationKeys) {
      const compared = detailSum(own(key), 'compared')
      const matched = detailSum(own(key), 'matched')
      accuracy[key] = compared.seen && compared.total > 0 ? { numerator: matched.total, denominator: compared.total } : null
      const inv = detailSum(own(key), 'invented')
      const mis = detailSum(own(key), 'missed')
      invented[key] = inv.seen ? inv.total : null
      missed[key] = mis.seen ? mis.total : null
    }
    const keyed = new Set(rows.filter((row) => typeof resultOf(row.results, 'answer-key')?.detail.compared === 'number').map((row) => row.caseKey)).size
    const empty = Object.fromEntries(configurationKeys.map((key) => [key, null]))
    return [
      { id: 'valid-json', label: 'Valid JSON', byConfiguration: Object.fromEntries(configurationKeys.map((key) => [key, rate(own(key), 'json-parse')])), caveat: null },
      { id: 'fits-schema', label: 'Fits the field list', byConfiguration: Object.fromEntries(configurationKeys.map((key) => [key, rate(own(key), 'json-schema')])), caveat: null },
      { id: 'required-filled', label: 'Must-fill fields filled', byConfiguration: Object.fromEntries(configurationKeys.map((key) => [key, rate(own(key), 'required-filled')])), caveat: null },
      { id: 'field-accuracy', label: 'Fields matching the answer key', byConfiguration: accuracy, caveat: smallSampleCaveat(keyed) },
      { id: 'invented', label: 'Invented values (against the answer key)', byConfiguration: empty, values: invented, unit: 'values', caveat: null },
      { id: 'missed', label: 'Missed values (against the answer key)', byConfiguration: empty, values: missed, unit: 'values', caveat: null },
    ]
  },
  jurorCaseView: (settings) => ({
    kind: 'extraction',
    fields: leafFields(settings.schema).slice(0, X.leafFields).map((leaf) => ({ label: leaf.node.title?.trim() || leaf.pattern.split('/').filter((segment) => segment !== '*').at(-1)!, mustFill: !leaf.optional })),
  }),
}
