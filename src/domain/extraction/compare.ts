/**
 * Comparing an extraction with the judge's answer key, field by field (spec 04 §9.3–9.4). Pure
 * and browser-safe. Belongs to kit `extraction-v1`: a different rule ships as a new kit version.
 *
 * Leaf outcomes: expected present and equal under the field's rule → match; present but
 * different → mismatch; expected present, output empty → missed; expected null (the judge says
 * the document doesn't have it), output filled → invented; both empty → match. A field the key
 * leaves out is not compared.
 */

import { z } from 'zod'
import { LIMITS } from '../limits'
import { utf8ByteLength } from '../text'
import { nodeAt, type ArrayNode, type ExtractionSchema, type FieldPath, type ObjectNode, type SchemaNode, type ScalarNode } from './schema'
import { isCalendarDate, isDateTime } from './validate'

export type FieldOutcome = 'match' | 'mismatch' | 'missed' | 'invented' | 'extra_item'

/** A judge's override for one field pattern (`/lineItems/*\/sku`). */
export type CompareRule = 'exact' | 'alnum' | 'date-only' | 'ordered' | 'set' | { tolerance: number } | { matchBy: string }

/** The rule that was applied, as recorded in each compared field. */
export type CompareMode = 'text' | 'exact' | 'alnum' | 'date' | 'instant' | 'date-only' | 'enum' | 'number' | 'tolerance' | 'boolean' | 'set' | 'ordered' | 'match-by'

export const compareRuleSchema = z.union([
  z.enum(['exact', 'alnum', 'date-only', 'ordered', 'set']),
  z.strictObject({ tolerance: z.number().finite().min(0) }),
  z.strictObject({ matchBy: z.string().min(1).max(64) }),
])

export const compareRulesSchema = z
  .record(z.string().regex(/^(\/([A-Za-z_][A-Za-z0-9_]{0,63}|\*))+$/u, 'A rule names a field path like /lineItems/*/sku'), compareRuleSchema)
  .refine((rules) => Object.keys(rules).length <= LIMITS.extraction.compareRules, `At most ${LIMITS.extraction.compareRules} comparison rules`)
  .refine((rules) => utf8ByteLength(JSON.stringify(rules)) <= LIMITS.extraction.compareBytes, `Comparison rules are at most ${LIMITS.extraction.compareBytes / 1024} KiB`)
export type CompareRules = z.infer<typeof compareRulesSchema>

export interface ComparedField {
  path: FieldPath
  outcome: FieldOutcome
  rule: CompareMode
  /** The answer key's value at this path (null = expected empty; undefined for an extra item). */
  expected?: unknown
  /** The output's value at this path (undefined when absent). */
  actual?: unknown
}

export interface CompareCounts {
  compared: number
  match: number
  mismatch: number
  missed: number
  /** Invented values plus extra list items. */
  invented: number
}

export interface CompareResult {
  fields: ComparedField[]
  counts: CompareCounts
}

/** Rules a field pattern may take; an empty list means only the default applies. */
function allowedRules(node: SchemaNode): string[] {
  if (node.type === 'string') {
    if (node.enum) return ['exact']
    if (node.format === 'date') return []
    if (node.format === 'date-time') return ['date-only']
    return ['exact', 'alnum']
  }
  if (node.type === 'number' || node.type === 'integer') return ['tolerance']
  if (node.type === 'array') return node.items.type === 'object' ? ['ordered', 'matchBy'] : ['ordered', 'set']
  return []
}

function ruleName(rule: CompareRule): string {
  return typeof rule === 'string' ? rule : 'tolerance' in rule ? 'tolerance' : 'matchBy'
}

/** Rules against the schema: each path must name a field, and the rule must suit its type. */
export function validateCompareRules(schema: ExtractionSchema, rules: CompareRules): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = []
  for (const [pattern, rule] of Object.entries(rules)) {
    const node = nodeAt(schema, pattern)
    if (!node || pattern.split('/').some((segment) => /^\d+$/u.test(segment))) {
      issues.push({ path: pattern, message: `"${pattern}" isn't a field in the field list (use * for list items).` })
      continue
    }
    const allowed = allowedRules(node)
    if (!allowed.includes(ruleName(rule))) {
      issues.push({ path: pattern, message: allowed.length === 0 ? `"${pattern}" is compared one way only; remove its rule.` : `"${pattern}" takes ${allowed.join(' or ')}.` })
      continue
    }
    if (typeof rule === 'object' && 'matchBy' in rule && node.type === 'array' && node.items.type === 'object') {
      const child = Object.hasOwn(node.items.properties, rule.matchBy) ? node.items.properties[rule.matchBy] : undefined
      if (!child || child.type === 'object' || child.type === 'array') issues.push({ path: pattern, message: `matchBy must name a text, number or yes/no field of each item.` })
    }
  }
  return issues
}

/** The rule set for a value path: exact match first, then the pattern with `*` for indices. */
function ruleFor(rules: CompareRules, path: FieldPath): CompareRule | undefined {
  if (Object.hasOwn(rules, path)) return rules[path]
  const pattern = path.replace(/\/(0|[1-9][0-9]*)(?=\/|$)/gu, '/*')
  return Object.hasOwn(rules, pattern) ? rules[pattern] : undefined
}

const CURLY: Record<string, string> = { '‘': "'", '’': "'", '‚': "'", '‛': "'", '“': '"', '”': '"', '„': '"', '‟': '"', '′': "'", '″': '"' }

/** `text` rule: NFKC, curly quotes straight, whitespace collapsed, trimmed, lower-cased (locale-independent). */
export function normalizeTextV1(value: string): string {
  let out = ''
  for (const char of value.normalize('NFKC')) out += CURLY[char] ?? char
  return out.replace(/\s+/gu, ' ').trim().toLowerCase()
}

/** `alnum` rule: letters and digits only, after NFKC, lower-cased. */
export function normalizeAlnumV1(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

function scalarMode(node: ScalarNode, rule: CompareRule | undefined): CompareMode {
  if (node.type === 'boolean') return 'boolean'
  if (node.type === 'number' || node.type === 'integer') return rule && typeof rule === 'object' && 'tolerance' in rule ? 'tolerance' : 'number'
  if (node.type !== 'string') return 'text'
  if (node.enum) return rule === 'exact' ? 'exact' : 'enum'
  if (node.format === 'date') return 'date'
  if (node.format === 'date-time') return rule === 'date-only' ? 'date-only' : 'instant'
  return rule === 'exact' ? 'exact' : rule === 'alnum' ? 'alnum' : 'text'
}

/** Whether two non-empty scalars are equal under a mode. */
export function scalarEqual(mode: CompareMode, expected: unknown, actual: unknown, rule?: CompareRule): boolean {
  switch (mode) {
    case 'boolean':
      return expected === actual
    case 'number':
    case 'tolerance': {
      if (typeof expected !== 'number' || typeof actual !== 'number') return false
      const tolerance = rule && typeof rule === 'object' && 'tolerance' in rule ? rule.tolerance : 1e-9 * Math.max(1, Math.abs(expected))
      return Math.abs(expected - actual) <= tolerance
    }
    default:
      break
  }
  if (typeof expected !== 'string' || typeof actual !== 'string') return false
  switch (mode) {
    case 'exact':
      return expected.normalize('NFC') === actual.normalize('NFC')
    case 'alnum':
      return normalizeAlnumV1(expected) === normalizeAlnumV1(actual)
    case 'enum':
      return expected.toLowerCase() === actual.toLowerCase()
    case 'date':
      return isCalendarDate(expected) && isCalendarDate(actual) && expected === actual
    case 'instant':
      return isDateTime(expected) && isDateTime(actual) && Date.parse(expected) === Date.parse(actual)
    case 'date-only':
      return isDateTime(expected) && isDateTime(actual) && expected.slice(0, 10) === actual.slice(0, 10)
    default:
      return normalizeTextV1(expected) === normalizeTextV1(actual)
  }
}

function hasFilledLeaf(value: unknown): boolean {
  if (isEmpty(value)) return false
  if (Array.isArray(value)) return value.some(hasFilledLeaf)
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasFilledLeaf)
  return true
}

function get(record: unknown, name: string): unknown {
  return typeof record === 'object' && record !== null && !Array.isArray(record) && Object.hasOwn(record, name) ? (record as Record<string, unknown>)[name] : undefined
}

/**
 * Compares an output with an answer key. Both are walked by the schema only. `output` is the
 * parsed value (or undefined when nothing parsed: every expected field is then missed).
 */
export function compareToAnswerKey(schema: ExtractionSchema, rules: CompareRules, answerKey: unknown, output: unknown): CompareResult {
  const fields: ComparedField[] = []
  const push = (field: ComparedField) => {
    if (fields.length < 2_000) fields.push(field)
  }

  const scalar = (node: ScalarNode, expected: unknown, actual: unknown, path: FieldPath) => {
    const rule = ruleFor(rules, path)
    const mode = scalarMode(node, rule)
    const expectedEmpty = isEmpty(expected)
    const actualEmpty = isEmpty(actual)
    const outcome: FieldOutcome = expectedEmpty ? (actualEmpty ? 'match' : 'invented') : actualEmpty ? 'missed' : scalarEqual(mode, expected, actual, rule) ? 'match' : 'mismatch'
    push({ path, outcome, rule: mode, expected: expected ?? null, ...(actual !== undefined ? { actual } : {}) })
  }

  const array = (node: ArrayNode, expected: unknown, actual: unknown, path: FieldPath) => {
    const rule = ruleFor(rules, path)
    const objects = node.items.type === 'object'
    const mode: CompareMode = objects ? (rule && typeof rule === 'object' && 'matchBy' in rule ? 'match-by' : 'ordered') : rule === 'ordered' ? 'ordered' : 'set'
    const expectedList = Array.isArray(expected) ? expected : null
    const actualList = Array.isArray(actual) ? actual : null
    if (expectedList === null) {
      // The key says this list isn't in the document.
      push({ path, outcome: actualList && actualList.some(hasFilledLeaf) ? 'invented' : 'match', rule: mode, expected: null, ...(actual !== undefined ? { actual } : {}) })
      return
    }
    if (expectedList.length === 0 && (actualList === null || actualList.length === 0)) {
      push({ path, outcome: 'match', rule: mode, expected: [], ...(actual !== undefined ? { actual } : {}) })
      return
    }
    const outputItems = actualList ?? []
    if (!objects && mode === 'set') {
      const itemMode = scalarMode(node.items as ScalarNode, ruleFor(rules, `${path}/*`))
      const itemRule = ruleFor(rules, `${path}/*`)
      const used = new Set<number>()
      expectedList.forEach((item, index) => {
        const found = outputItems.findIndex((candidate, j) => !used.has(j) && !isEmpty(candidate) && !isEmpty(item) && scalarEqual(itemMode, item, candidate, itemRule))
        if (found >= 0) {
          used.add(found)
          push({ path: `${path}/${index}`, outcome: 'match', rule: 'set', expected: item, actual: outputItems[found] })
        } else push({ path: `${path}/${index}`, outcome: 'missed', rule: 'set', expected: item })
      })
      outputItems.forEach((item, j) => {
        if (!used.has(j)) push({ path: `${path}/${j}`, outcome: 'extra_item', rule: 'set', actual: item })
      })
      return
    }
    // Ordered (or paired by a field): pair items, recurse, then report the leftovers.
    const pairs: Array<[number, number | null]> = []
    const used = new Set<number>()
    if (mode === 'match-by') {
      const by = (rule as { matchBy: string }).matchBy
      const child = (node.items as ObjectNode).properties[by] as ScalarNode
      const childMode = scalarMode(child, ruleFor(rules, `${path}/*/${by}`))
      expectedList.forEach((item, index) => {
        const key = get(item, by)
        const found = isEmpty(key) ? -1 : outputItems.findIndex((candidate, j) => !used.has(j) && !isEmpty(get(candidate, by)) && scalarEqual(childMode, key, get(candidate, by)))
        if (found >= 0) used.add(found)
        pairs.push([index, found >= 0 ? found : null])
      })
    } else {
      expectedList.forEach((_, index) => {
        if (index < outputItems.length) used.add(index)
        pairs.push([index, index < outputItems.length ? index : null])
      })
    }
    for (const [index, j] of pairs) {
      const itemPath = `${path}/${index}`
      if (j === null) {
        if (objects) visit(node.items, expectedList[index], undefined, itemPath)
        else push({ path: itemPath, outcome: 'missed', rule: mode, expected: expectedList[index] })
      } else if (objects) visit(node.items, expectedList[index], outputItems[j], itemPath)
      else scalar(node.items as ScalarNode, expectedList[index], outputItems[j], itemPath)
    }
    outputItems.forEach((item, j) => {
      if (!used.has(j) && hasFilledLeaf(item)) push({ path: `${path}/${j}`, outcome: 'extra_item', rule: mode, actual: item })
    })
  }

  const visit = (node: SchemaNode, expected: unknown, actual: unknown, path: FieldPath) => {
    if (node.type === 'object') {
      if (expected === null) {
        push({ path, outcome: hasFilledLeaf(actual) ? 'invented' : 'match', rule: 'text', expected: null, ...(actual !== undefined ? { actual } : {}) })
        return
      }
      for (const [name, child] of Object.entries(node.properties)) {
        if (typeof expected !== 'object' || expected === null || !Object.hasOwn(expected, name)) continue
        visit(child, (expected as Record<string, unknown>)[name], get(actual, name), `${path}/${name}`)
      }
      return
    }
    if (node.type === 'array') return array(node, expected, actual, path)
    scalar(node, expected, actual, path)
  }

  visit(schema, answerKey, output, '')
  const counts: CompareCounts = { compared: 0, match: 0, mismatch: 0, missed: 0, invented: 0 }
  for (const field of fields) {
    if (field.outcome === 'extra_item') counts.invented += 1
    else {
      counts.compared += 1
      counts[field.outcome] += 1
    }
  }
  return { fields, counts }
}
