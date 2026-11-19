import { describe, expect, it } from 'vitest'
import type { CaseInput, Configuration } from '../contracts'
import { estimateExtractionInput } from './estimate'

const party = (systemPrompt: string): Configuration => ({ key: crypto.randomUUID(), label: 'P', modelKey: 'm', systemPrompt, maxOutputTokens: 512 })
const question = (document: object | undefined, input = 'Extract.'): CaseInput => ({ key: crypto.randomUUID(), title: 'T', input, reference: '', expectedBehavior: 'E', kitFields: { kind: 'extraction', ...(document ? { document } : {}) } as CaseInput['kitFields'] })

describe('estimateExtractionInput', () => {
  it('counts the document, the request, the largest system prompt and the schema allowance, per party and sample', () => {
    const cases = [question({ sha256: 'a'.repeat(64), byteLength: 4000, delivery: 'text', pageCount: null }, '12345678')]
    const estimate = estimateExtractionInput(cases, [party('x'.repeat(40)), party('y'.repeat(8))], 2)
    expect(estimate.perCall[0].tokens).toBe(10 + 2 + 1000 + 300)
    expect(estimate.total).toBe(1312 * 2 * 2)
  })

  it('uses 4,500 tokens a native PDF page, and ignores imported parties', () => {
    const cases = [question({ sha256: 'a'.repeat(64), byteLength: 99, delivery: 'pdf_native', pageCount: 20 }, 'x')]
    const imported = { kind: 'imported', key: crypto.randomUUID(), label: 'I', provenance: { sourceType: 'other', description: 'd', redacted: false } } as Configuration
    const estimate = estimateExtractionInput(cases, [party('s'), imported])
    expect(estimate.perCall[0]).toMatchObject({ tokens: 1 + 1 + 90_000 + 300, pdfPages: 20 })
    expect(estimate.total).toBe(90_302)
  })
})
