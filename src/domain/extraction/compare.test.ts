import { describe, expect, it } from 'vitest'
import { compareToAnswerKey, normalizeAlnumV1, normalizeTextV1, validateCompareRules, type CompareRules } from './compare'
import type { ExtractionSchema } from './schema'

const schema: ExtractionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    invoiceNo: { type: 'string' },
    due: { type: 'string', format: 'date' },
    at: { type: 'string', format: 'date-time' },
    level: { type: 'string', enum: ['Low', 'High'] },
    total: { type: 'number' },
    paid: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, amount: { type: 'number' } }, required: ['sku', 'amount'] } },
    po: { type: 'string' },
  },
  required: ['name'],
}

function outcomes(key: unknown, output: unknown, rules: CompareRules = {}) {
  return Object.fromEntries(compareToAnswerKey(schema, rules, key, output).fields.map((field) => [field.path, field.outcome]))
}

describe('normalizers', () => {
  it('text: NFKC, curly quotes, whitespace, case', () => {
    expect(normalizeTextV1('  Ｏ’Brien   Ltd  ')).toBe("o'brien ltd")
    expect(normalizeAlnumV1('INV-００１ / 2')).toBe('inv0012')
  })
})

describe('compareToAnswerKey', () => {
  it('text rule by default, exact and alnum on request', () => {
    expect(outcomes({ name: 'Acme Ltd' }, { name: ' acme  LTD ' })).toEqual({ '/name': 'match' })
    expect(outcomes({ name: 'Acme Ltd' }, { name: 'acme ltd' }, { '/name': 'exact' })).toEqual({ '/name': 'mismatch' })
    expect(outcomes({ invoiceNo: 'INV-001' }, { invoiceNo: 'inv 001' }, { '/invoiceNo': 'alnum' })).toEqual({ '/invoiceNo': 'match' })
    expect(outcomes({ invoiceNo: 'INV-001' }, { invoiceNo: 'inv 001' })).toEqual({ '/invoiceNo': 'mismatch' })
  })

  it('dates, instants and date-only', () => {
    expect(outcomes({ due: '2026-03-01' }, { due: '2026-03-01' })).toEqual({ '/due': 'match' })
    expect(outcomes({ due: '2026-03-01' }, { due: '2026-02-30' })).toEqual({ '/due': 'mismatch' })
    expect(outcomes({ at: '2026-03-01T10:00:00+02:00' }, { at: '2026-03-01T08:00:00Z' })).toEqual({ '/at': 'match' })
    expect(outcomes({ at: '2026-03-01T23:00:00-05:00' }, { at: '2026-03-02T04:00:00Z' }, { '/at': 'date-only' })).toEqual({ '/at': 'mismatch' })
    expect(outcomes({ at: '2026-03-01T23:00:00-05:00' }, { at: '2026-03-01T01:00:00-05:00' }, { '/at': 'date-only' })).toEqual({ '/at': 'match' })
  })

  it('enum ignores case unless exact; numbers within tolerance', () => {
    expect(outcomes({ level: 'High' }, { level: 'high' })).toEqual({ '/level': 'match' })
    expect(outcomes({ level: 'High' }, { level: 'high' }, { '/level': 'exact' })).toEqual({ '/level': 'mismatch' })
    expect(outcomes({ total: 10 }, { total: 10.000000001 })).toEqual({ '/total': 'match' })
    expect(outcomes({ total: 10 }, { total: 10.01 })).toEqual({ '/total': 'mismatch' })
    expect(outcomes({ total: 10 }, { total: 10.01 }, { '/total': { tolerance: 0.01 } })).toEqual({ '/total': 'match' })
    expect(outcomes({ total: 10 }, { total: 10.02 }, { '/total': { tolerance: 0.01 } })).toEqual({ '/total': 'mismatch' })
    expect(outcomes({ paid: true }, { paid: false })).toEqual({ '/paid': 'mismatch' })
  })

  it('missed and invented', () => {
    expect(outcomes({ po: 'PO-7' }, { po: null })).toEqual({ '/po': 'missed' })
    expect(outcomes({ po: 'PO-7' }, { po: '  ' })).toEqual({ '/po': 'missed' })
    expect(outcomes({ po: null }, { po: 'PO-7' })).toEqual({ '/po': 'invented' })
    expect(outcomes({ po: null }, { po: null })).toEqual({ '/po': 'match' })
    expect(outcomes({ po: 'PO-7' }, undefined)).toEqual({ '/po': 'missed' })
    expect(outcomes({}, { po: 'x' })).toEqual({})
  })

  it('scalar lists are multisets by default, with duplicates', () => {
    expect(outcomes({ tags: ['a', 'b', 'a'] }, { tags: ['B', 'a', 'c'] })).toEqual({ '/tags/0': 'match', '/tags/1': 'match', '/tags/2': 'extra_item' })
    const counts = compareToAnswerKey(schema, {}, { tags: ['a', 'b', 'a'] }, { tags: ['B', 'a', 'c'] }).counts
    expect(counts).toEqual({ compared: 3, match: 2, mismatch: 0, missed: 1, invented: 1 })
    expect(outcomes({ tags: ['a', 'b'] }, { tags: ['b', 'a'] }, { '/tags': 'ordered' })).toEqual({ '/tags/0': 'mismatch', '/tags/1': 'mismatch' })
    expect(outcomes({ tags: [] }, { tags: [] })).toEqual({ '/tags': 'match' })
    expect(outcomes({ tags: null }, { tags: ['x'] })).toEqual({ '/tags': 'invented' })
  })

  it('object lists pair by index or by a field', () => {
    const key = { lines: [{ sku: 'A', amount: 1 }, { sku: 'B', amount: 2 }] }
    expect(outcomes(key, { lines: [{ sku: 'B', amount: 2 }, { sku: 'A', amount: 1 }, { sku: 'C', amount: 3 }] })).toEqual({
      '/lines/0/sku': 'mismatch', '/lines/0/amount': 'mismatch', '/lines/1/sku': 'mismatch', '/lines/1/amount': 'mismatch', '/lines/2': 'extra_item',
    })
    expect(outcomes(key, { lines: [{ sku: 'b', amount: 2 }, { sku: 'A', amount: 1 }] }, { '/lines': { matchBy: 'sku' } })).toEqual({
      '/lines/0/sku': 'match', '/lines/0/amount': 'match', '/lines/1/sku': 'match', '/lines/1/amount': 'match',
    })
    expect(outcomes(key, { lines: [{ sku: null, amount: 2 }] }, { '/lines': { matchBy: 'sku' } })).toEqual({
      '/lines/0/sku': 'missed', '/lines/0/amount': 'missed', '/lines/1/sku': 'missed', '/lines/1/amount': 'missed', '/lines/0': 'extra_item',
    })
  })

  it('a rule for list items applies through *', () => {
    const key = { lines: [{ sku: 'INV-1', amount: 1 }] }
    expect(outcomes(key, { lines: [{ sku: 'inv1', amount: 1 }] }, { '/lines/*/sku': 'alnum' })).toEqual({ '/lines/0/sku': 'match', '/lines/0/amount': 'match' })
  })
})

describe('validateCompareRules', () => {
  it('checks each rule against its field type', () => {
    expect(validateCompareRules(schema, { '/name': 'alnum', '/total': { tolerance: 0.01 }, '/lines': { matchBy: 'sku' }, '/tags': 'ordered', '/at': 'date-only', '/lines/*/sku': 'exact' })).toEqual([])
    expect(validateCompareRules(schema, { '/total': 'exact' })[0].message).toContain('tolerance')
    expect(validateCompareRules(schema, { '/due': 'exact' })[0].message).toContain('one way only')
    expect(validateCompareRules(schema, { '/nope': 'exact' })[0].message).toContain("isn't a field")
    expect(validateCompareRules(schema, { '/lines/0/sku': 'exact' })[0].message).toContain("isn't a field")
    expect(validateCompareRules(schema, { '/lines': { matchBy: 'nope' } })[0].message).toContain('matchBy')
  })
})
