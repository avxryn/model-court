/**
 * The JSON Schema subset for mock-tool arguments (spec 06 §4.2, D-99). Pure and browser-safe.
 *
 * Workers forbid `eval` and `new Function`, so code-generating validators (Ajv) are out. This is a
 * small interpreter that checks a tool's `parameters` schema itself and then validates call
 * arguments against it. It reads only own properties the schema names, never follows
 * `__proto__`, and never compiles a judge-written regular expression (`pattern` is refused).
 *
 * Item 4's extraction validator is not reused: it is bound to `extraction-v1`'s strict-wire
 * semantics (every field present, `minimum`/`minLength` refused), and changing it would change a
 * published kit. This subset fits inside both providers' documented strict-mode subsets, so a
 * later strict switch needs no schema migration.
 */

import { canonicalJson } from '../canonical'
import { LIMITS } from '../limits'
import { codePointLength, utf8ByteLength } from '../text'

const T = LIMITS.tools

export type ToolSchema = Record<string, unknown>

export interface SchemaIssue {
  /** Dotted path into the value (`items.0.sku`), or into the schema for schema issues; '' is the root. */
  path: string
  message: string
}

const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])
const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'description'])
const PROPERTY_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

/** Refused keywords, each with the fix in plain words. */
const REFUSED: Record<string, string> = {
  $ref: '`$ref` isn’t supported. Write the argument out where it is used.',
  $defs: '`$defs` isn’t supported. Write each argument out where it is used.',
  definitions: '`definitions` isn’t supported. Write each argument out where it is used.',
  pattern: '`pattern` isn’t supported. Say the format in the description instead.',
  patternProperties: '`patternProperties` isn’t supported. List each argument under `properties`.',
  format: '`format` isn’t supported. Say the format in the description instead.',
  anyOf: '`anyOf` isn’t supported. Use one type (or a type and "null") per argument.',
  oneOf: '`oneOf` isn’t supported. Use one type (or a type and "null") per argument.',
  allOf: '`allOf` isn’t supported. Merge the parts into one argument.',
  not: '`not` isn’t supported. Say what to avoid in the description.',
  if: '`if`/`then`/`else` isn’t supported. Say the condition in the description.',
  then: '`if`/`then`/`else` isn’t supported. Say the condition in the description.',
  else: '`if`/`then`/`else` isn’t supported. Say the condition in the description.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

function join(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`
}

function quoted(path: string): string {
  return path === '' ? 'The arguments' : `\`${path}\``
}

/** The types a schema node allows: one type, or one type and "null". */
export function typesOf(node: ToolSchema): string[] {
  const type = node.type
  return Array.isArray(type) ? type.filter((item): item is string => typeof item === 'string') : typeof type === 'string' ? [type] : []
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Issues with the schema itself (≤ 5 shown first, but all are found). The root must be an object
 * schema. Depth counts object and array levels below the root (≤ 4); properties count over the
 * whole schema (≤ 24); the canonical JSON is ≤ 4 KiB.
 */
export function schemaIssues(schema: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  if (!isRecord(schema)) return [{ path: '', message: 'The arguments schema must be a JSON object.' }]
  let size: number
  try {
    size = utf8ByteLength(canonicalJson(schema))
  } catch {
    return [{ path: '', message: 'The arguments schema must be plain JSON.' }]
  }
  if (size > T.parametersBytes) issues.push({ path: '', message: `The arguments schema is at most ${T.parametersBytes / 1024} KiB.` })
  if (typesOf(schema).join() !== 'object') issues.push({ path: 'type', message: 'The top level must be `"type": "object"`.' })
  let properties = 0
  const walk = (node: unknown, path: string, depth: number) => {
    if (!isRecord(node)) {
      issues.push({ path, message: `${path === '' ? 'The schema' : `\`${path}\``} must be a JSON object.` })
      return
    }
    for (const key of Object.keys(node)) {
      if (Object.hasOwn(REFUSED, key)) issues.push({ path: join(path, key), message: REFUSED[key] })
      else if (!KEYWORDS.has(key)) issues.push({ path: join(path, key), message: `\`${key}\` isn’t supported in tool arguments.` })
    }
    const types = typesOf(node)
    const typeOk =
      (typeof node.type === 'string' && TYPES.has(node.type)) ||
      (Array.isArray(node.type) && node.type.length === 2 && node.type.every((t) => typeof t === 'string' && TYPES.has(t)) && node.type.includes('null') && node.type[0] !== node.type[1])
    if (!typeOk) {
      issues.push({ path: join(path, 'type'), message: '`type` must be one of string, number, integer, boolean, object, array, null, or a pair of one type and "null".' })
      return
    }
    if (node.description !== undefined && (typeof node.description !== 'string' || codePointLength(node.description) > T.description.max)) {
      issues.push({ path: join(path, 'description'), message: `A description is text of at most ${T.description.max.toLocaleString('en-US')} characters.` })
    }
    if (node.enum !== undefined) {
      if (!Array.isArray(node.enum) || node.enum.length === 0 || node.enum.length > T.enumValues || !node.enum.every(isScalar)) {
        issues.push({ path: join(path, 'enum'), message: `\`enum\` is a list of 1–${T.enumValues} plain values (text, numbers, true/false or null).` })
      }
    }
    if (node.const !== undefined && !isScalar(node.const)) issues.push({ path: join(path, 'const'), message: '`const` is one plain value.' })
    for (const key of ['minimum', 'maximum'] as const) {
      if (node[key] !== undefined && !(typeof node[key] === 'number' && Number.isFinite(node[key]))) issues.push({ path: join(path, key), message: `\`${key}\` is a number.` })
      else if (node[key] !== undefined && !types.some((t) => t === 'number' || t === 'integer')) issues.push({ path: join(path, key), message: `\`${key}\` applies to numbers only.` })
    }
    for (const key of ['minLength', 'maxLength'] as const) {
      if (node[key] !== undefined && !isCount(node[key])) issues.push({ path: join(path, key), message: `\`${key}\` is a whole number of characters.` })
      else if (node[key] !== undefined && !types.includes('string')) issues.push({ path: join(path, key), message: `\`${key}\` applies to text only.` })
    }
    for (const key of ['minItems', 'maxItems'] as const) {
      if (node[key] !== undefined && !isCount(node[key])) issues.push({ path: join(path, key), message: `\`${key}\` is a whole number.` })
      else if (node[key] !== undefined && !types.includes('array')) issues.push({ path: join(path, key), message: `\`${key}\` applies to lists only.` })
    }
    if (types.includes('object')) {
      if (depth > T.parametersDepth) {
        issues.push({ path, message: `Arguments nest at most ${T.parametersDepth} levels deep.` })
        return
      }
      const props = node.properties
      if (props !== undefined && !isRecord(props)) {
        issues.push({ path: join(path, 'properties'), message: '`properties` is an object of argument schemas.' })
      } else if (props) {
        for (const name of Object.keys(props)) {
          properties++
          if (!PROPERTY_NAME.test(name) || RESERVED.has(name)) issues.push({ path: join(join(path, 'properties'), name), message: `\`${name}\` isn’t a usable argument name. Use letters, digits, _ or -, starting with a letter or _, at most 64 characters.` })
          else walk(props[name], join(join(path, 'properties'), name), depth + 1)
        }
      }
      if (node.required !== undefined) {
        const names = isRecord(props) ? props : {}
        if (!Array.isArray(node.required) || !node.required.every((name) => typeof name === 'string') || new Set(node.required).size !== node.required.length) {
          issues.push({ path: join(path, 'required'), message: '`required` is a list of argument names, each once.' })
        } else {
          for (const name of node.required as string[]) if (!Object.hasOwn(names, name)) issues.push({ path: join(path, 'required'), message: `\`${name}\` is required but not listed under \`properties\`.` })
        }
      }
      if (node.additionalProperties !== undefined && node.additionalProperties !== false) issues.push({ path: join(path, 'additionalProperties'), message: '`additionalProperties` may only be false (or left out).' })
    } else {
      for (const key of ['properties', 'required', 'additionalProperties'] as const) if (node[key] !== undefined) issues.push({ path: join(path, key), message: `\`${key}\` applies to objects only.` })
    }
    if (types.includes('array')) {
      if (depth > T.parametersDepth) {
        issues.push({ path, message: `Arguments nest at most ${T.parametersDepth} levels deep.` })
        return
      }
      if (node.items !== undefined) walk(node.items, join(path, 'items'), depth + 1)
    } else if (node.items !== undefined) {
      issues.push({ path: join(path, 'items'), message: '`items` applies to lists only.' })
    }
  }
  walk(schema, '', 0)
  if (properties > T.parametersProperties) issues.push({ path: 'properties', message: `A tool has at most ${T.parametersProperties} arguments in all (nested ones included).` })
  return issues
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null':
      return value === null
    case 'boolean':
      return typeof value === 'boolean'
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isRecord(value)
    default:
      return false
  }
}

const TYPE_WORDS: Record<string, string> = { string: 'text', number: 'a number', integer: 'a whole number', boolean: 'true or false', object: 'an object', array: 'a list', null: 'null' }

/** Keys sorted at every level. `Object.fromEntries` defines own properties, so `__proto__` stays a plain key. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
  return value
}

/** Sorted keys, 2-space indent: how arguments are shown, and what their size is measured on (D-105). */
export function prettyJson(value: unknown): string {
  return JSON.stringify(sorted(value), null, 2)
}

/** Equality of plain JSON values: numbers numerically, strings exactly, objects by own keys. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]))
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
  }
  return false
}

function validateNode(node: ToolSchema, value: unknown, path: string, issues: SchemaIssue[]): void {
  if (issues.length >= T.issues) return
  const types = typesOf(node)
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    issues.push({ path, message: `${quoted(path)} must be ${types.map((type) => TYPE_WORDS[type] ?? type).join(' or ')}, not ${typeName(value)}.` })
    return
  }
  if (Array.isArray(node.enum) && !node.enum.some((option) => jsonEqual(option, value))) {
    issues.push({ path, message: `${quoted(path)} must be one of ${node.enum.slice(0, 8).map((option) => JSON.stringify(option)).join(', ')}${node.enum.length > 8 ? ', …' : ''}.` })
  }
  if (node.const !== undefined && !jsonEqual(node.const, value)) issues.push({ path, message: `${quoted(path)} must be ${JSON.stringify(node.const)}.` })
  if (typeof value === 'number') {
    if (typeof node.minimum === 'number' && value < node.minimum) issues.push({ path, message: `${quoted(path)} must be at least ${node.minimum}.` })
    if (typeof node.maximum === 'number' && value > node.maximum) issues.push({ path, message: `${quoted(path)} must be at most ${node.maximum}.` })
  }
  if (typeof value === 'string') {
    const length = codePointLength(value)
    if (typeof node.minLength === 'number' && length < node.minLength) issues.push({ path, message: `${quoted(path)} must be at least ${node.minLength} characters.` })
    if (typeof node.maxLength === 'number' && length > node.maxLength) issues.push({ path, message: `${quoted(path)} must be at most ${node.maxLength} characters.` })
  }
  if (Array.isArray(value)) {
    if (typeof node.minItems === 'number' && value.length < node.minItems) issues.push({ path, message: `${quoted(path)} needs at least ${node.minItems} items.` })
    if (typeof node.maxItems === 'number' && value.length > node.maxItems) issues.push({ path, message: `${quoted(path)} has at most ${node.maxItems} items.` })
    if (isRecord(node.items)) {
      const items = node.items
      value.forEach((item, index) => validateNode(items, item, join(path, index), issues))
    }
  }
  if (isRecord(value)) {
    const props = isRecord(node.properties) ? node.properties : {}
    if (Array.isArray(node.required)) {
      for (const name of node.required) if (typeof name === 'string' && !Object.hasOwn(value, name)) issues.push({ path: join(path, name), message: `\`${join(path, name)}\` is required.` })
    }
    for (const key of Object.keys(value)) {
      if (issues.length >= T.issues) return
      if (Object.hasOwn(props, key) && isRecord(props[key])) validateNode(props[key], value[key], join(path, key), issues)
      else if (node.additionalProperties === false) issues.push({ path: join(path, key), message: `\`${join(path, key)}\` isn’t an argument of this tool.` })
    }
  }
}

/** Validate a value against a schema that passed `schemaIssues`. At most 5 issues, in a stable order. */
export function validate(schema: ToolSchema, value: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  validateNode(schema, value, '', issues)
  return issues.slice(0, T.issues)
}

/**
 * Validate a partial instance (a canned response's `when`, a required call's `withArguments`):
 * an object whose every key is a top-level argument of the tool and whose every value fits that
 * argument's schema. Required arguments may be left out.
 */
export function validatePartial(schema: ToolSchema, value: unknown): SchemaIssue[] {
  if (!isRecord(value)) return [{ path: '', message: 'Use a JSON object of argument values, like {"order_id": "A-1042"}.' }]
  const props = isRecord(schema.properties) ? schema.properties : {}
  const issues: SchemaIssue[] = []
  for (const key of Object.keys(value)) {
    if (issues.length >= T.issues) break
    if (!Object.hasOwn(props, key) || !isRecord(props[key])) issues.push({ path: key, message: `\`${key}\` isn’t an argument of this tool.` })
    else validateNode(props[key], value[key], key, issues)
  }
  return issues.slice(0, T.issues)
}
