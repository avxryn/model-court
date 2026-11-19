/**
 * Field lists for the extraction kit (spec 04 §7). Pure and browser-safe.
 *
 * The judge writes an *authoring* schema: a small, portable subset of JSON Schema in which
 * `required` says which fields must be filled and every other field may be empty. Neither
 * provider accepts that shape in strict mode, so `compileWireSchema` turns it into the *wire*
 * schema both providers receive: every property required, optional ones widened to
 * `[T, "null"]`, `additionalProperties: false` everywhere. The compiler belongs to the kit
 * version (`extraction-v1`); a different wire shape ships as a new kit version.
 */

import { canonicalJson, sha256Hex } from '../canonical'
import { LIMITS } from '../limits'
import { codePointLength, utf8ByteLength } from '../text'

const X = LIMITS.extraction

export const STRING_FORMATS = ['date', 'date-time', 'time', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid'] as const
export type StringFormat = (typeof STRING_FORMATS)[number]

interface Described {
  title?: string
  description?: string
}

export type ObjectNode = Described & { type: 'object'; properties: Record<string, SchemaNode>; required?: string[] }
export type ArrayNode = Described & { type: 'array'; items: SchemaNode }
export type StringNode = Described & { type: 'string'; enum?: string[]; format?: StringFormat }
export type NumberNode = Described & { type: 'number' | 'integer' }
export type BooleanNode = Described & { type: 'boolean' }
export type ScalarNode = StringNode | NumberNode | BooleanNode
export type SchemaNode = ObjectNode | ArrayNode | ScalarNode

/** The judge's schema: always an object at the root (an OpenAI rule). */
export type ExtractionSchema = ObjectNode

/** What a provider receives (spec 04 §7.1). */
export type WireSchema = Record<string, unknown>

/** RFC 6901 pointer into a value (`/lineItems/2/amount`); `*` stands for any array index in rules. */
export type FieldPath = string

export interface SchemaIssue {
  /** Pointer into the schema itself, e.g. `/properties/total/minimum`. */
  path: string
  message: string
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean'])
const COMMON = new Set(['type', 'title', 'description'])
const ALLOWED: Record<string, ReadonlySet<string>> = {
  object: new Set([...COMMON, 'properties', 'required']),
  array: new Set([...COMMON, 'items']),
  string: new Set([...COMMON, 'enum', 'format']),
  number: COMMON,
  integer: COMMON,
  boolean: COMMON,
}

/** Refused keywords, each with the fix in plain words (spec 04 §7.2). */
const REFUSED: Record<string, string> = {
  $ref: "`$ref` isn't supported. Write the field out where it is used.",
  $defs: "`$defs` isn't supported. Write each field out where it is used.",
  definitions: "`definitions` isn't supported. Write each field out where it is used.",
  oneOf: "`oneOf` isn't supported. Use one type per field, and say the alternatives in its description.",
  anyOf: "`anyOf` isn't supported. Use one type per field, and say the alternatives in its description.",
  allOf: "`allOf` isn't supported. Merge the parts into one field.",
  not: "`not` isn't supported. Say what to avoid in the field's description.",
  if: '`if`/`then`/`else` isn\'t supported. Say the condition in the field\'s description.',
  then: '`if`/`then`/`else` isn\'t supported. Say the condition in the field\'s description.',
  else: '`if`/`then`/`else` isn\'t supported. Say the condition in the field\'s description.',
  pattern: "`pattern` isn't supported by Anthropic's structured outputs. Say the format in the field's description instead.",
  minimum: "`minimum` isn't supported by Anthropic's structured outputs. Say the range in the field's description instead.",
  maximum: "`maximum` isn't supported by Anthropic's structured outputs. Say the range in the field's description instead.",
  exclusiveMinimum: "`exclusiveMinimum` isn't supported by Anthropic's structured outputs. Say the range in the field's description instead.",
  exclusiveMaximum: "`exclusiveMaximum` isn't supported by Anthropic's structured outputs. Say the range in the field's description instead.",
  multipleOf: "`multipleOf` isn't supported by Anthropic's structured outputs. Say it in the field's description instead.",
  minLength: "`minLength` isn't supported by Anthropic's structured outputs. Say the length in the field's description instead.",
  maxLength: "`maxLength` isn't supported by Anthropic's structured outputs. Say the length in the field's description instead.",
  minItems: "`minItems` isn't supported. Say how many items to expect in the field's description instead.",
  maxItems: "`maxItems` isn't supported. Say how many items to expect in the field's description instead.",
  uniqueItems: "`uniqueItems` isn't supported. Say it in the field's description instead.",
  const: "`const` isn't supported. Use an enum with one value, or leave the field out.",
  default: "`default` isn't supported. Say the default in the field's description instead.",
  patternProperties: "`patternProperties` isn't supported. List each field under `properties`.",
  additionalProperties: '`additionalProperties` is set by Model Court (always false). Remove it.',
  prefixItems: 'Tuple arrays aren\'t supported. Use `items` with one schema.',
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pointerEscape(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

interface Tally {
  leaves: number
  optional: number
  enumValues: number
}

/**
 * Validates the judge's schema against the portable subset. Returns every issue found (up to
 * 50), each naming the keyword and the fix, or the schema itself typed.
 */
export function validateAuthoringSchema(value: unknown): { ok: true; schema: ExtractionSchema } | { ok: false; issues: SchemaIssue[] } {
  const issues: SchemaIssue[] = []
  const add = (path: string, message: string) => {
    if (issues.length < 50) issues.push({ path, message })
  }
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: '', message: 'The field list must be a JSON object.' }] }
  if (value.type !== 'object') add('/type', 'The top level must be `"type": "object"` with `properties`.')
  let bytes = 0
  try {
    bytes = utf8ByteLength(canonicalJson(value))
  } catch {
    add('', 'The field list must be plain JSON.')
  }
  if (bytes > X.schemaBytes) add('', `The field list is ${Math.ceil(bytes / 1024)} KiB; at most ${X.schemaBytes / 1024} KiB.`)
  const tally: Tally = { leaves: 0, optional: 0, enumValues: 0 }
  walk(value, '', 1, tally, add)
  if (tally.leaves > X.leafFields) add('', `The field list has ${tally.leaves} fields; at most ${X.leafFields}.`)
  if (tally.leaves === 0 && issues.length === 0) add('/properties', 'Add at least one field.')
  if (tally.optional > X.nullableFields) add('', `${tally.optional} fields are marked May be empty; at most ${X.nullableFields} (Anthropic allows ${X.nullableFields} optional fields a request). Mark more of them Must be filled, or remove some.`)
  if (tally.enumValues > X.enumValuesTotal) add('', `The field list has ${tally.enumValues} allowed values in total; at most ${X.enumValuesTotal}.`)
  return issues.length === 0 ? { ok: true, schema: value as unknown as ExtractionSchema } : { ok: false, issues }
}

function walk(node: unknown, path: string, depth: number, tally: Tally, add: (path: string, message: string) => void): void {
  if (!isPlainObject(node)) {
    add(path, 'Each field must be a JSON object with a `type`.')
    return
  }
  const type = node.type
  if (Array.isArray(type)) {
    add(`${path}/type`, 'A list of types isn\'t supported. Use one type and mark the field May be empty instead of adding "null".')
    return
  }
  if (type === 'null') {
    add(`${path}/type`, 'The `null` type isn\'t supported. Mark the field May be empty instead.')
    return
  }
  if (typeof type !== 'string' || !TYPES.has(type)) {
    add(`${path}/type`, 'Each field needs a `type`: object, array, string, number, integer or boolean.')
    return
  }
  const allowed = ALLOWED[type]
  for (const key of Object.keys(node)) {
    if (allowed.has(key)) continue
    add(`${path}/${pointerEscape(key)}`, REFUSED[key] ?? `\`${key}\` isn't supported on a ${type} field.`)
  }
  for (const key of ['title', 'description'] as const) {
    const text = node[key]
    if (text === undefined) continue
    if (typeof text !== 'string') add(`${path}/${key}`, `\`${key}\` must be text.`)
    else if (codePointLength(text) > X.describeChars) add(`${path}/${key}`, `\`${key}\` is at most ${X.describeChars} characters.`)
  }
  if (type === 'object') {
    if (depth > X.depth) add(path, `Fields nest at most ${X.depth} levels deep.`)
    const properties = node.properties
    if (!isPlainObject(properties)) {
      add(`${path}/properties`, 'An object field needs `properties`.')
      return
    }
    const names = Object.keys(properties)
    if (names.length === 0) add(`${path}/properties`, 'An object field needs at least one property.')
    const required = node.required
    let requiredSet = new Set<string>()
    if (required !== undefined) {
      if (!Array.isArray(required) || !required.every((item) => typeof item === 'string')) add(`${path}/required`, '`required` must be a list of field names.')
      else {
        requiredSet = new Set(required)
        if (requiredSet.size !== required.length) add(`${path}/required`, '`required` names a field twice.')
        required.forEach((name, index) => {
          if (!Object.hasOwn(properties, name)) add(`${path}/required/${index}`, `\`required\` names "${name}", which isn't one of the properties.`)
        })
      }
    }
    for (const name of names) {
      const childPath = `${path}/properties/${pointerEscape(name)}`
      if (!NAME.test(name) || RESERVED.has(name)) {
        add(childPath, `"${name}" can't be a field name. Use letters, digits and underscores (up to 64, not starting with a digit), and not __proto__, constructor or prototype.`)
        continue
      }
      if (!requiredSet.has(name)) tally.optional += 1
      walk(properties[name], childPath, depth + 1, tally, add)
    }
    return
  }
  if (type === 'array') {
    const items = node.items
    if (Array.isArray(items)) {
      add(`${path}/items`, 'Tuple arrays aren\'t supported. Use `items` with one schema.')
      return
    }
    if (!isPlainObject(items)) {
      add(`${path}/items`, 'An array field needs `items`.')
      return
    }
    if (items.type === 'array') {
      add(`${path}/items`, 'Lists of lists aren\'t supported. Make the items objects with a list inside.')
      return
    }
    const before = tally.leaves
    walk(items, `${path}/items`, depth, tally, add)
    // A list of scalars counts as one field; a list of objects counts its object's fields.
    if (items.type !== 'object') tally.leaves = before + 1
    return
  }
  tally.leaves += 1
  if (type !== 'string') return
  if (node.format !== undefined && !(STRING_FORMATS as readonly unknown[]).includes(node.format)) {
    add(`${path}/format`, `\`format\` must be one of ${STRING_FORMATS.join(', ')}.`)
  }
  if (node.enum !== undefined) {
    const values = node.enum
    if (!Array.isArray(values) || values.length === 0 || !values.every((item) => typeof item === 'string')) {
      add(`${path}/enum`, '`enum` must be a list of text values.')
      return
    }
    if (values.length > X.enumValues) add(`${path}/enum`, `A field allows at most ${X.enumValues} values.`)
    tally.enumValues += values.length
    const seen = new Map<string, number>()
    values.forEach((item, index) => {
      const length = codePointLength(item)
      if (length < 1 || length > X.enumValueChars || item.trim() !== item) add(`${path}/enum/${index}`, `An allowed value is 1–${X.enumValueChars} characters, without spaces at either end.`)
      const key = item.toLowerCase()
      if (seen.has(key)) add(`${path}/enum/${index}`, `"${item}" repeats value ${seen.get(key)! + 1} ignoring capitalization (Anthropic may change capitalization, so the two couldn't be told apart).`)
      else seen.set(key, index)
    })
    if (node.format !== undefined) add(`${path}/format`, 'A field with allowed values can\'t also have a `format`.')
  }
}

// ---------------------------------------------------------------------------
// Walking a validated schema
// ---------------------------------------------------------------------------

export function isOptional(parent: ObjectNode, name: string): boolean {
  return !(parent.required ?? []).includes(name)
}

export interface LeafField {
  /** Pointer pattern with `*` for array items: `/lineItems/*\/amount`. */
  pattern: FieldPath
  node: ScalarNode | ArrayNode
  /** May be empty in the authoring schema (this property, not an ancestor). */
  optional: boolean
}

/** Every leaf in schema order: scalars, and arrays of scalars as one leaf. */
export function leafFields(schema: ExtractionSchema): LeafField[] {
  const out: LeafField[] = []
  const visit = (node: ObjectNode, prefix: string) => {
    for (const [name, child] of Object.entries(node.properties)) {
      const pattern = `${prefix}/${name}`
      if (child.type === 'object') visit(child, pattern)
      else if (child.type === 'array' && child.items.type === 'object') visit(child.items, `${pattern}/*`)
      else out.push({ pattern, node: child, optional: isOptional(node, name) })
    }
  }
  visit(schema, '')
  return out
}

/** The schema node a value pointer (or pattern) addresses, or null. */
export function nodeAt(schema: ExtractionSchema, path: FieldPath): SchemaNode | null {
  if (path === '') return schema
  let node: SchemaNode = schema
  for (const segment of path.split('/').slice(1)) {
    if (node.type === 'object') {
      if (!Object.hasOwn(node.properties, segment)) return null
      node = node.properties[segment]
    } else if (node.type === 'array') {
      if (segment !== '*' && !/^(0|[1-9][0-9]{0,3})$/u.test(segment)) return null
      node = node.items
    } else return null
  }
  return node
}

// ---------------------------------------------------------------------------
// Wire schema (spec 04 §7.1)
// ---------------------------------------------------------------------------

function describedOf(node: Described): Described {
  return { ...(node.title !== undefined ? { title: node.title } : {}), ...(node.description !== undefined ? { description: node.description } : {}) }
}

function wireNode(node: SchemaNode, nullable: boolean): Record<string, unknown> {
  const type = nullable ? [node.type, 'null'] : node.type
  if (node.type === 'object') {
    const properties: Record<string, unknown> = {}
    for (const [name, child] of Object.entries(node.properties)) properties[name] = wireNode(child, isOptional(node, name))
    return { type, ...describedOf(node), properties, required: Object.keys(node.properties), additionalProperties: false }
  }
  if (node.type === 'array') return { type, ...describedOf(node), items: wireNode(node.items, false) }
  if (node.type === 'string') {
    return {
      type,
      ...describedOf(node),
      ...(node.enum ? { enum: nullable ? [...node.enum, null] : [...node.enum] } : {}),
      ...(node.format ? { format: node.format } : {}),
    }
  }
  return { type, ...describedOf(node) }
}

/**
 * The provider-facing schema. Deterministic: the same authoring schema always gives the same
 * bytes, properties in authoring order, every object closed.
 */
export function compileWireSchema(schema: ExtractionSchema): WireSchema {
  return wireNode(schema, false)
}

/** The hash a record shows for the field list a hearing sent (canonical JSON of the wire schema). */
export function schemaSha256(schema: ExtractionSchema): Promise<string> {
  return sha256Hex(canonicalJson(compileWireSchema(schema)))
}

/** Field names that suggest an identifier, so the editor can warn that integers lose digits past 2^53. */
export function looksLikeIdentifier(name: string): boolean {
  return /(^|_)(id|number|no|phone|account)$/iu.test(name) || /(Id|Number|Phone|Account)$/u.test(name)
}
