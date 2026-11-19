/**
 * A small interpreting validator for the portable subset (spec 04 §7.3). Pure and browser-safe.
 * Ajv is not used: it generates code with `new Function`, which Workers refuse. The walk goes
 * only as deep as the schema does and reads only own properties the schema names, so a
 * `__proto__` key in an output is reported as an extra field and never followed.
 *
 * Two modes over the same authoring schema:
 * - `output`: the wire semantics a provider was asked for. Every property must be present;
 *   one the judge marked May be empty may be null; no other properties.
 * - `answerKey`: the judge's key. Must-fill fields must be present and not null; May-be-empty
 *   fields may be null (expected empty) or left out (not compared); no other properties.
 */

import { LIMITS } from '../limits'
import { isOptional, type ExtractionSchema, type FieldPath, type SchemaNode, type StringFormat } from './schema'

export interface ValueIssue {
  path: FieldPath
  problem: string
}

export type ValidationMode = 'output' | 'answerKey'

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u
const TIME = /^(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/iu
const DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/u
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/u
const HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u
const IPV4_PART = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/u
const HEX4 = /^[0-9A-Fa-f]{1,4}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function isCalendarDate(value: string): boolean {
  const match = DATE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day <= days
}

function isTimeOfDay(value: string, offsetRequired: boolean): boolean {
  const match = TIME.exec(value)
  if (!match) return false
  if (offsetRequired && !match[5]) return false
  const [hour, minute, second] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (hour > 23 || minute > 59 || second > 60) return false
  const offset = match[5]
  if (offset && offset.toUpperCase() !== 'Z') {
    const [h, m] = offset.slice(1).split(':').map(Number)
    if (h > 23 || m > 59) return false
  }
  return true
}

/** RFC 3339 `date-time`: a calendar date, `T`, a time and an offset or `Z`. */
export function isDateTime(value: string): boolean {
  const t = value.search(/[Tt ]/u)
  if (t !== 10) return false
  return isCalendarDate(value.slice(0, 10)) && isTimeOfDay(value.slice(11), true)
}

function isHostname(value: string): boolean {
  if (value.length < 1 || value.length > 253) return false
  return value.replace(/\.$/u, '').split('.').every((label) => HOST_LABEL.test(label))
}

function isIpv4(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts.every((part) => IPV4_PART.test(part))
}

function isIpv6(value: string): boolean {
  if (value.length > 45) return false
  let head = value
  let v4 = 0
  const lastColon = value.lastIndexOf(':')
  if (lastColon >= 0 && value.slice(lastColon + 1).includes('.')) {
    if (!isIpv4(value.slice(lastColon + 1))) return false
    head = value.slice(0, lastColon + 1) + '0'
    v4 = 1
  }
  const halves = head.split('::')
  if (halves.length > 2) return false
  const groups = halves.map((half) => (half === '' ? [] : half.split(':')))
  if (!groups.every((list) => list.every((group) => HEX4.test(group)))) return false
  const count = groups.reduce((sum, list) => sum + list.length, 0) + v4
  return halves.length === 2 ? count <= 8 : count === 8
}

export function matchesFormat(format: StringFormat, value: string): boolean {
  switch (format) {
    case 'date':
      return isCalendarDate(value)
    case 'date-time':
      return isDateTime(value)
    case 'time':
      return isTimeOfDay(value, false)
    case 'duration':
      return DURATION.test(value)
    case 'email': {
      const at = value.lastIndexOf('@')
      return EMAIL.test(value) && isHostname(value.slice(at + 1))
    }
    case 'hostname':
      return isHostname(value)
    case 'ipv4':
      return isIpv4(value)
    case 'ipv6':
      return isIpv6(value)
    case 'uuid':
      return UUID.test(value)
  }
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

const FORMAT_WORDS: Record<StringFormat, string> = {
  date: 'a date like 2026-11-18',
  'date-time': 'a date and time with an offset, like 2026-11-18T09:30:00Z',
  time: 'a time like 09:30:00',
  duration: 'a duration like P3D',
  email: 'an email address',
  hostname: 'a host name',
  ipv4: 'an IPv4 address',
  ipv6: 'an IPv6 address',
  uuid: 'a UUID',
}

/**
 * Validates a parsed value. Returns at most `LIMITS.extraction.validatorErrors` issues, in
 * schema order. Never throws on any JSON value.
 */
export function validateAgainstSchema(schema: ExtractionSchema, value: unknown, mode: ValidationMode = 'output'): ValueIssue[] {
  const issues: ValueIssue[] = []
  const max = LIMITS.extraction.validatorErrors
  const add = (path: FieldPath, problem: string) => {
    if (issues.length < max) issues.push({ path, problem })
  }
  const visit = (node: SchemaNode, current: unknown, path: FieldPath, nullable: boolean) => {
    if (issues.length >= max) return
    if (current === null) {
      if (!nullable) add(path, mode === 'answerKey' ? 'must be filled (the field is Must be filled)' : `expected ${node.type}, got null`)
      return
    }
    switch (node.type) {
      case 'object': {
        if (typeof current !== 'object' || Array.isArray(current)) return add(path, `expected object, got ${typeName(current)}`)
        const record = current as Record<string, unknown>
        for (const [name, child] of Object.entries(node.properties)) {
          const childPath = `${path}/${name}`
          const optional = isOptional(node, name)
          if (!Object.hasOwn(record, name)) {
            if (mode === 'output' || !optional) add(childPath, 'missing')
            continue
          }
          visit(child, record[name], childPath, optional)
        }
        for (const key of Object.keys(record)) {
          if (!Object.hasOwn(node.properties, key)) add(`${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, 'not in the field list')
        }
        return
      }
      case 'array': {
        if (!Array.isArray(current)) return add(path, `expected array, got ${typeName(current)}`)
        if (mode === 'answerKey' && current.length > LIMITS.extraction.answerKeyArrayItems) add(path, `at most ${LIMITS.extraction.answerKeyArrayItems} items in an answer key`)
        current.forEach((item, index) => visit(node.items, item, `${path}/${index}`, false))
        return
      }
      case 'string': {
        if (typeof current !== 'string') return add(path, `expected string, got ${typeName(current)}`)
        if (node.enum && !node.enum.includes(current)) {
          // A case-only difference passes (Anthropic documents that it may change capitalization); checks note it.
          const lower = current.toLowerCase()
          if (!node.enum.some((item) => item.toLowerCase() === lower)) add(path, 'not one of the allowed values')
        }
        if (node.format && !matchesFormat(node.format, current)) add(path, `expected ${FORMAT_WORDS[node.format]}`)
        return
      }
      case 'integer':
        if (typeof current !== 'number' || !Number.isInteger(current)) add(path, `expected integer, got ${typeName(current)}`)
        return
      case 'number':
        if (typeof current !== 'number' || !Number.isFinite(current)) add(path, `expected number, got ${typeName(current)}`)
        return
      case 'boolean':
        if (typeof current !== 'boolean') add(path, `expected boolean, got ${typeName(current)}`)
        return
    }
  }
  visit(schema, value, '', false)
  return issues
}

/** Enum values whose capitalization differs from the schema's spelling (pointer paths). */
export function capitalizationDifferences(schema: ExtractionSchema, value: unknown): FieldPath[] {
  const out: FieldPath[] = []
  const visit = (node: SchemaNode, current: unknown, path: FieldPath) => {
    if (current === null || current === undefined) return
    if (node.type === 'object' && typeof current === 'object' && !Array.isArray(current)) {
      for (const [name, child] of Object.entries(node.properties)) {
        if (Object.hasOwn(current, name)) visit(child, (current as Record<string, unknown>)[name], `${path}/${name}`)
      }
    } else if (node.type === 'array' && Array.isArray(current)) {
      current.forEach((item, index) => visit(node.items, item, `${path}/${index}`))
    } else if (node.type === 'string' && node.enum && typeof current === 'string' && !node.enum.includes(current)) {
      if (node.enum.some((item) => item.toLowerCase() === current.toLowerCase())) out.push(path)
    }
  }
  visit(schema, value, '')
  return out
}
