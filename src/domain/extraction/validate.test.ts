import { describe, expect, it } from 'vitest'
import type { ExtractionSchema } from './schema'
import { capitalizationDifferences, isCalendarDate, isDateTime, matchesFormat, validateAgainstSchema } from './validate'

const schema: ExtractionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    due: { type: 'string', format: 'date' },
    level: { type: 'string', enum: ['Low', 'High'] },
    count: { type: 'integer' },
    total: { type: 'number' },
    paid: { type: 'boolean' },
    lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] } },
  },
  required: ['name', 'count', 'lines'],
}

const valid = { name: 'Acme', due: '2026-02-28', level: 'High', count: 2, total: 9.5, paid: false, lines: [{ sku: 'A-1' }] }

describe('validateAgainstSchema (output mode)', () => {
  it('accepts a complete answer, nulls only where allowed', () => {
    expect(validateAgainstSchema(schema, valid)).toEqual([])
    expect(validateAgainstSchema(schema, { ...valid, due: null, level: null, total: null, paid: null })).toEqual([])
  })

  it('reports types, missing and extra fields, enums and formats with pointer paths', () => {
    const issues = validateAgainstSchema(schema, { name: null, due: '2026-02-30', level: 'Medium', count: 2.5, total: '9.5', paid: 'no', lines: [{ sku: 1, extra: true }], more: 1 })
    expect(issues).toEqual([
      { path: '/name', problem: 'expected string, got null' },
      { path: '/due', problem: 'expected a date like 2026-11-18' },
      { path: '/level', problem: 'not one of the allowed values' },
      { path: '/count', problem: 'expected integer, got number' },
      { path: '/total', problem: 'expected number, got string' },
      { path: '/paid', problem: 'expected boolean, got string' },
      { path: '/lines/0/sku', problem: 'expected string, got integer' },
      { path: '/lines/0/extra', problem: 'not in the field list' },
      { path: '/more', problem: 'not in the field list' },
    ])
    expect(validateAgainstSchema(schema, { name: 'x' }).map((issue) => issue.path)).toEqual(['/due', '/level', '/count', '/total', '/paid', '/lines'])
    expect(validateAgainstSchema(schema, [])).toEqual([{ path: '', problem: 'expected object, got array' }])
  })

  it('caps the issues at 10', () => {
    const wide: ExtractionSchema = { type: 'object', properties: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, { type: 'string' as const }])), required: [] }
    expect(validateAgainstSchema(wide, {})).toHaveLength(10)
  })

  it('accepts a capitalization-only enum difference and notes it', () => {
    expect(validateAgainstSchema(schema, { ...valid, level: 'high' })).toEqual([])
    expect(capitalizationDifferences(schema, { ...valid, level: 'high' })).toEqual(['/level'])
  })

  it('never follows __proto__ in an output', () => {
    const value = JSON.parse('{"name":"a","count":1,"lines":[],"due":null,"level":null,"total":null,"paid":null,"__proto__":{"polluted":true}}')
    expect(validateAgainstSchema(schema, value)).toEqual([{ path: '/__proto__', problem: 'not in the field list' }])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('validateAgainstSchema (answer key mode)', () => {
  it('lets May-be-empty fields be null or absent, but not must-fill ones', () => {
    expect(validateAgainstSchema(schema, { name: 'Acme', count: 1, lines: [] }, 'answerKey')).toEqual([])
    expect(validateAgainstSchema(schema, { name: null, lines: [] }, 'answerKey')).toEqual([
      { path: '/name', problem: 'must be filled (the field is Must be filled)' },
      { path: '/count', problem: 'missing' },
    ])
    expect(validateAgainstSchema(schema, { name: 'a', count: 1, lines: Array.from({ length: 51 }, () => ({ sku: 'x' })) }, 'answerKey')[0].problem).toContain('at most 50')
  })
})

describe('formats', () => {
  it('dates are real calendar dates', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true)
    expect(isCalendarDate('2023-02-29')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-1-01')).toBe(false)
  })

  it('date-times need an offset or Z', () => {
    expect(isDateTime('2026-11-18T09:30:00Z')).toBe(true)
    expect(isDateTime('2026-11-18T09:30:00.123+05:30')).toBe(true)
    expect(isDateTime('2026-11-18T09:30:00')).toBe(false)
    expect(isDateTime('2026-11-18T24:30:00Z')).toBe(false)
  })

  it.each([
    ['time', '09:30:00', true], ['time', '9:30', false],
    ['duration', 'P3D', true], ['duration', 'PT1H30M', true], ['duration', 'P', false], ['duration', 'PT', false],
    ['email', 'a@example.com', true], ['email', 'a@@example.com', false], ['email', 'no-at', false],
    ['hostname', 'example.com', true], ['hostname', '-bad.com', false],
    ['ipv4', '192.168.0.1', true], ['ipv4', '256.1.1.1', false],
    ['ipv6', '2001:db8::1', true], ['ipv6', '::ffff:192.0.2.1', true], ['ipv6', '1::2::3', false],
    ['uuid', '123e4567-e89b-12d3-a456-426614174000', true], ['uuid', '123e4567', false],
  ] as const)('%s %s → %s', (format, value, ok) => {
    expect(matchesFormat(format, value)).toBe(ok)
  })
})
