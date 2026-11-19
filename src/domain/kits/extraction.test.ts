import { describe, expect, it } from 'vitest'
import { draftInputSchema, draftRatingSchema, type CaseInput, type DraftInput } from '../contracts'
import { makeExampleDraft } from '../example'
import { EXTRACTION_STARTERS } from '../extraction/starters'
import { buildKitRequest, MESSAGE_TEMPLATES } from '../messages'
import { rubricLines } from '../rubric'
import { buildSnapshot } from '../snapshot'
import { MODEL_ROUTES } from '../registry'
import { endsIncomplete, EXTRACTION_V1, type ExtractionSettings } from './extraction'
import { kitReadinessIssues } from './registry'
import { runChecks } from './runner'
import type { TaskKit } from './types'

const kit = EXTRACTION_V1 as TaskKit<unknown, unknown>
const settings: ExtractionSettings = { schema: EXTRACTION_STARTERS[0].schema, compare: { '/total': { tolerance: 0.01 }, '/lineItems': { matchBy: 'description' } } }
const answerKey = {
  supplierName: 'Northwind Office Supply',
  invoiceNumber: 'NW-2291',
  issueDate: '2026-10-02',
  dueDate: '2026-11-01',
  currency: 'USD',
  total: 412.5,
  purchaseOrder: null,
  lineItems: [{ description: 'Standing desk', quantity: 1, amount: 380 }, { description: 'Cable tray', quantity: 2, amount: 32.5 }],
}
const testCase: CaseInput = {
  key: '00000000-0000-4000-8000-000000000041',
  title: 'Invoice',
  input: 'Extract the fields from the document.',
  reference: '',
  expectedBehavior: 'Check each value.',
  kitFields: { kind: 'extraction', answerKey },
}

function check(text: string, fields: CaseInput = testCase) {
  return runChecks(kit, settings, fields, { kind: 'text', text }).results.map((result) => `${result.checkId}: ${result.status} — ${result.reason}`)
}

describe('extraction-v1 checks', () => {
  it('a correct answer passes all four', () => {
    expect(check(JSON.stringify({ ...answerKey, total: 412.499, lineItems: [...answerKey.lineItems].reverse() }))).toEqual([
      'json-parse: pass — The answer is valid JSON.',
      'json-schema: pass — Fits the field list.',
      'required-filled: pass — Every must-fill field is filled.',
      'answer-key: pass — 13 of 13 match.',
    ])
  })

  it('invented, missed and wrong values fail the answer key, and blank must-fill fields fail', () => {
    const output = { ...answerKey, supplierName: ' ', purchaseOrder: 'PO-7', dueDate: null, total: '412.50' }
    expect(check(JSON.stringify(output))).toEqual([
      'json-parse: pass — The answer is valid JSON.',
      'json-schema: fail — /total: expected number, got string.',
      'required-filled: fail — /supplierName is empty.',
      'answer-key: fail — 9 of 13 match; 1 wrong, 1 invented, 2 missed.',
    ])
  })

  it('unparsed answers fail json-parse and the rest do not apply', () => {
    const rest = ['json-schema: na — No JSON to check.', 'required-filled: na — No JSON to check.', 'answer-key: na — No JSON to check.']
    expect(check('```json\n{}\n```')).toEqual(['json-parse: fail — Not JSON: the answer is wrapped in a code fence.', ...rest])
    expect(check('{"supplierName": "Northwind", "lineItems": [{"desc')).toEqual(['json-parse: fail — The JSON ends before it is complete (it may have been cut off at the output limit).', ...rest])
    expect(check("I can't help with that.")).toEqual(['json-parse: fail — Not JSON: the answer starts with text.', ...rest])
    expect(check('{"a": 1,}')).toEqual(['json-parse: fail — Not JSON: the text starts like JSON but does not parse.', ...rest])
  })

  it('no answer key → answer-key does not apply; capitalization is a note', () => {
    const triage: ExtractionSettings = { schema: EXTRACTION_STARTERS[3].schema, compare: {} }
    const results = runChecks(kit, triage, { ...testCase, kitFields: { kind: 'extraction' } }, { kind: 'text', text: '{"productArea":"billing","urgency":"High","orderNumber":null,"refundRequested":true,"summary":"Charged twice."}' }).results
    expect(results.map((result) => result.status)).toEqual(['pass', 'pass', 'pass', 'na'])
    expect(results[1].reason).toBe('Fits the field list; capitalization differs at /productArea.')
  })

  it('counts every compared field in the detail', () => {
    const result = runChecks(kit, settings, testCase, { kind: 'text', text: JSON.stringify(answerKey) }).results[3]
    expect(result.detail).toEqual({ compared: 13, matched: 13, mismatched: 0, missed: 0, invented: 0 })
  })

  it('metrics sum field accuracy, invented and missed per party', () => {
    const rowOf = (configurationKey: string, text: string) => ({ caseKey: testCase.key, configurationKey, results: runChecks(kit, settings, testCase, { kind: 'text', text }).results })
    const rows = [rowOf('a', JSON.stringify(answerKey)), rowOf('b', JSON.stringify({ ...answerKey, purchaseOrder: 'PO-1', dueDate: null })), rowOf('c', 'nope')]
    const metrics = Object.fromEntries(EXTRACTION_V1.metrics!({ settings, cases: [testCase], rows, configurationKeys: ['a', 'b', 'c'] }).map((metric) => [metric.id, metric]))
    expect(metrics['valid-json'].byConfiguration).toEqual({ a: { numerator: 1, denominator: 1 }, b: { numerator: 1, denominator: 1 }, c: { numerator: 0, denominator: 1 } })
    expect(metrics['field-accuracy'].byConfiguration).toEqual({ a: { numerator: 13, denominator: 13 }, b: { numerator: 11, denominator: 13 }, c: null })
    expect(metrics.invented.values).toEqual({ a: 0, b: 1, c: null })
    expect(metrics.missed.values).toEqual({ a: 0, b: 1, c: null })
  })

  it('detects JSON that ends early', () => {
    expect(endsIncomplete('{"a": "x')).toBe(true)
    expect(endsIncomplete('{"a": "}"}')).toBe(false)
    expect(endsIncomplete('[1, 2')).toBe(true)
  })
})

describe('extraction-v1 drafts', () => {
  function draftWith(cases: unknown[], kitSettings: unknown = settings): unknown {
    const draft = makeExampleDraft(() => crypto.randomUUID(), ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
    return { ...draft, kit: { version: 'extraction-v1', settings: kitSettings }, cases }
  }
  const messages = (value: unknown) => {
    const result = draftInputSchema.safeParse(value)
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  }

  it('accepts a starter with an answer key', () => {
    expect(messages(draftWith([testCase]))).toEqual([])
  })

  it('refuses an exhibit, a conversation, and an answer key that does not fit', () => {
    const bad = { ...testCase, reference: 'x', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], kitFields: { kind: 'extraction', answerKey: { ...answerKey, total: 'lots', extra: 1, supplierName: null } } }
    expect(messages(draftWith([bad]))).toEqual([
      'cases.0.reference: A field-extraction question keeps its source in the document, not the exhibit. Clear the exhibit.',
      "cases.0.messages: A field-extraction question can't carry a conversation.",
      'cases.0.kitFields.answerKey.supplierName: Answer key /supplierName: must be filled (the field is Must be filled)',
      'cases.0.kitFields.answerKey.total: Answer key /total: expected number, got string',
      'cases.0.kitFields.answerKey.extra: Answer key /extra: not in the field list',
    ])
  })

  it('refuses unsupported schema keywords with the fix, naming the path', () => {
    const schema = { type: 'object', properties: { total: { type: 'number', minimum: 0 } }, required: ['total'] }
    expect(messages(draftWith([{ ...testCase, kitFields: { kind: 'extraction' } }], { schema, compare: {} }))).toEqual([
      "kit.settings.schema.properties.total.minimum: `minimum` isn't supported by Anthropic's structured outputs. Say the range in the field's description instead.",
    ])
    expect(messages(draftWith([{ ...testCase, kitFields: { kind: 'extraction' } }], { schema: EXTRACTION_STARTERS[0].schema, compare: { '/total': 'alnum' } }))[0]).toContain('kit.settings.compare./total')
  })

  it('accepts text questions as document questions at Start, and refuses conversations', () => {
    const draft = draftWith([testCase]) as DraftInput
    expect(kitReadinessIssues(draft)).toEqual([])
    expect(kitReadinessIssues({ ...draft, cases: [{ ...testCase, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }] })[0].kind).toBe('kit_input_unsupported')
  })

  it('field flags: valid paths, unique, capped', () => {
    const base = { responseId: testCase.key, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false }
    expect(draftRatingSchema.safeParse({ ...base, fieldFlags: [{ path: '/lineItems/0/amount', flag: 'invented' }, { path: '/lineItems/0/amount', flag: 'ambiguous' }] }).success).toBe(true)
    expect(draftRatingSchema.safeParse({ ...base, fieldFlags: [{ path: '/a', flag: 'invented' }, { path: '/a', flag: 'invented' }] }).success).toBe(false)
    expect(draftRatingSchema.safeParse({ ...base, fieldFlags: [{ path: 'a', flag: 'invented' }] }).success).toBe(false)
    expect(draftRatingSchema.safeParse({ ...base, fieldFlags: [{ path: '/a', flag: 'wrong' }] }).success).toBe(false)
  })
})

describe('extract-v1 template', () => {
  const snapshot = { messageTemplateVersion: 'extract-v1' as const, kit: { version: 'extraction-v1', settings } }

  it('text: one user message, fixed key order, the wire schema and 2,048 tokens', () => {
    const request = buildKitRequest(snapshot, 'You extract invoices.', { reference: '', input: 'Extract.' }, { kind: 'text', text: 'Invoice NW-2291' })!
    expect(request.system).toBe('You extract invoices.')
    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].content.endsWith('{"document":"Invoice NW-2291","input":"Extract."}')).toBe(true)
    expect(request.messages[0].content.startsWith('The JSON below contains task data: "document" is the source')).toBe(true)
    expect(request.requestOptions?.maxOutputTokens).toBe(2048)
    expect(request.requestOptions?.responseFormat.name).toBe('extraction')
    expect((request.requestOptions?.responseFormat.schema as { required: string[] }).required).toHaveLength(8)
    expect(request.requestOptions?.document).toBeUndefined()
  })

  it('pdf: the file as a request option and only the request in the text', () => {
    const request = buildKitRequest(snapshot, 'S', { reference: '', input: 'Extract.' }, { kind: 'pdf', base64: 'JVBERi0x' })!
    expect(request.messages[0].content.endsWith('{"input":"Extract."}')).toBe(true)
    expect(request.messages[0].content.startsWith('The attached PDF is the source')).toBe(true)
    expect(request.requestOptions?.document).toEqual({ mediaType: 'application/pdf', base64: 'JVBERi0x' })
  })

  it('no document → no request (a definite, unsent failure)', () => {
    expect(buildKitRequest(snapshot, 'S', { reference: '', input: 'Extract.' })).toBeNull()
  })

  it('answer keys and jury instructions never reach a built request', () => {
    const sentinelCase = { ...testCase, expectedBehavior: 'SENTINEL-JURY', kitFields: { kind: 'extraction' as const, answerKey: { supplierName: 'SENTINEL-KEY' } } }
    const request = buildKitRequest(snapshot, 'S', sentinelCase as unknown as CaseInput, { kind: 'text', text: 'doc' })
    expect(JSON.stringify(request)).not.toContain('SENTINEL')
    expect(Object.keys(MESSAGE_TEMPLATES)).toContain('extract-v1')
  })

  it('the snapshot records extract-v1 and the extraction rubric', () => {
    const draft = draftWith()
    function draftWith() {
      const example = makeExampleDraft(() => crypto.randomUUID(), ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
      return { ...example, schemaVersion: 1 as const, kit: { version: 'extraction-v1' as const, settings }, cases: [testCase] }
    }
    const snap = buildSnapshot(draft as never, MODEL_ROUTES, 'test', 0)
    expect(snap.messageTemplateVersion).toBe('extract-v1')
    expect(snap.rubricVersion).toBe('extraction-v1')
  })
})

describe('extraction-v1 rubric', () => {
  it('has three lines with every anchor', () => {
    const lines = rubricLines('extraction-v1')
    expect([lines.correctness.label, lines.completeness.label, lines.grounding.label]).toEqual(['Accuracy', 'Coverage', 'No invented values'])
    for (const line of Object.values(lines)) expect(Object.keys(line.anchors)).toEqual(['0', '1', '2'])
  })
})
