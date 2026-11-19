import { describe, expect, it } from 'vitest'
import { canonicalExtractionJson, describePath, flaggablePaths, parseOutput, renderFields } from './render'
import { EXTRACTION_STARTERS } from './starters'

const invoice = EXTRACTION_STARTERS[0].schema
const triage = EXTRACTION_STARTERS[3].schema

describe('canonical rendering', () => {
  it('uses authoring order whatever the output order, and the same bytes for equivalent outputs', () => {
    const a = parseOutput('{"total": 1.0, "supplierName": "Acme", "lineItems": [{"amount": 2, "quantity": 1, "description": "x"}], "currency": "USD"}')
    const b = parseOutput('  {"currency":"USD","supplierName":"Acme","lineItems":[{"description":"x","quantity":1.0,"amount":2.00}],"total":1}\n')
    expect(a.status).toBe('parsed')
    const textA = canonicalExtractionJson(invoice, (a as { value: unknown }).value)
    expect(textA).toBe(canonicalExtractionJson(invoice, (b as { value: unknown }).value))
    expect(textA.split('\n')[1]).toBe('  "supplierName": "Acme",')
    expect(textA).toContain('"total": 1,')
  })

  it('shows enum values in the schema spelling, and keeps extra keys sorted after schema keys', () => {
    const text = canonicalExtractionJson(triage, { zeta: 1, urgency: 'HIGH', alpha: { b: 1, a: 2 }, productArea: 'billing' })
    expect(JSON.parse(text)).toEqual({ productArea: 'Billing', urgency: 'High', alpha: { a: 2, b: 1 }, zeta: 1 })
    expect(Object.keys(JSON.parse(text))).toEqual(['productArea', 'urgency', 'alpha', 'zeta'])
  })

  it('does not parse fenced or wrapped JSON', () => {
    expect(parseOutput('```json\n{}\n```').status).toBe('unparsed')
    expect(parseOutput('Here: {}').status).toBe('unparsed')
    expect(parseOutput('').status).toBe('unparsed')
  })
})

describe('renderFields', () => {
  it('lists fields in schema order with groups for lists and empty values', () => {
    const rows = renderFields(invoice, { lineItems: [{ description: 'Desk', quantity: 1, amount: 200 }], supplierName: 'Acme', dueDate: null, total: 200, currency: 'usd', issueDate: '2026-01-02', invoiceNumber: 'A-1', purchaseOrder: '' })
    expect(rows.map((row) => `${'  '.repeat(row.depth)}${row.label}${row.kind === 'value' ? ` = ${row.value ?? '— left empty'}` : ''}`)).toEqual([
      'Supplier = Acme',
      'Invoice number = A-1',
      'Issue date = 2026-01-02',
      'Due date = — left empty',
      'Currency = usd',
      'Total = 200',
      'Purchase order = — left empty',
      'Line items',
      '  Line items 1',
      '    Description = Desk',
      '    Quantity = 1',
      '    Amount = 200',
    ])
    expect([...flaggablePaths(invoice, { lineItems: [{ description: 'Desk' }] })]).toContain('/lineItems/0/description')
  })

  it('describes paths with titles', () => {
    expect(describePath(invoice, '/lineItems/2/amount')).toBe('Line items[3].Amount')
  })
})
