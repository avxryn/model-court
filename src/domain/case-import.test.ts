import { describe, expect, it } from 'vitest'
import { applyImportedCases, parseCasesCsv } from './case-import'
import { toCsv } from './csv'
import { makeExampleDraft } from './example'
import { LIMITS } from './limits'

const newId = () => crypto.randomUUID()
const HEADER = ['title', 'input', 'reference', 'expected_behavior']
const row = (n: number) => [`Case ${n}`, `Question ${n}?`, 'Returns within 30 days.', `Answer ${n} from the reference.`]

describe('parseCasesCsv', () => {
  it('turns rows into draft cases with fresh keys, values kept exactly', () => {
    const csv = toCsv(HEADER, [row(1), ['Café, "quoted"', 'Line one\nline two', '', '  keep spaces  ']])
    const result = parseCasesCsv(csv, newId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cases).toHaveLength(2)
    expect(result.cases[0]).toMatchObject({ title: 'Case 1', input: 'Question 1?', reference: 'Returns within 30 days.', expectedBehavior: 'Answer 1 from the reference.' })
    expect(result.cases[1]).toMatchObject({ title: 'Café, "quoted"', input: 'Line one\nline two', reference: '', expectedBehavior: '  keep spaces  ' })
    expect(result.cases[0].key).not.toBe(result.cases[1].key)
  })

  it('accepts header variants, any column order, a BOM, and a missing reference column', () => {
    const csv = String.fromCharCode(0xfeff) + 'Expected Behavior,Title\nBe exact,My case\n'
    const missingInput = parseCasesCsv(csv, newId)
    expect(missingInput).toMatchObject({ ok: false, issues: [{ field: 'input', message: 'Missing required column "input".' }] })
    const ok = parseCasesCsv('Input,expected-behavior,TITLE\nWhat now?,Ask a question,Missing facts\n', newId)
    expect(ok).toMatchObject({ ok: true, cases: [{ title: 'Missing facts', input: 'What now?', reference: '', expectedBehavior: 'Ask a question' }] })
  })

  it('rejects unknown and duplicate columns (strict, like the draft schema)', () => {
    const unknown = parseCasesCsv('title,input,expected_behavior,model\na,b,c,gpt\n', newId)
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.issues[0].message).toMatch(/Unknown column "model"/)
    const duplicate = parseCasesCsv('title,input,expected_behavior,Title\na,b,c,d\n', newId)
    expect(duplicate).toMatchObject({ ok: false, issues: [{ field: 'title' }] })
  })

  it('reports per-row field errors from the shared Zod contract', () => {
    const csv = toCsv(HEADER, [row(1), ['', 'q', '', 'e'], ['t', 'x'.repeat(LIMITS.caseInput.max + 1), '', 'e']])
    const result = parseCasesCsv(csv, newId)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      { row: 2, field: 'title', message: 'Title must be 1–100 characters' },
      { row: 3, field: 'input', message: 'Input must be 1–4,000 characters' },
    ])
  })

  it('enforces the case count, ragged rows, malformed quoting, and the byte cap', () => {
    expect(parseCasesCsv(toCsv(HEADER, []), newId)).toMatchObject({ ok: false, issues: [{ message: 'The file has no cases below the header row.' }] })
    expect(parseCasesCsv('', newId)).toMatchObject({ ok: false })
    expect(parseCasesCsv(toCsv(HEADER, [1, 2, 3, 4, 5].map(row)), newId).ok).toBe(true)
    expect(parseCasesCsv(toCsv(HEADER, [1, 2, 3, 4, 5, 6].map(row)), newId)).toMatchObject({ ok: false, issues: [{ message: 'At most 5 cases; the file has 6.' }] })
    expect(parseCasesCsv('title,input,expected_behavior\na,b\n', newId)).toMatchObject({ ok: false, issues: [{ row: 1, message: 'Row has 2 cells; the header has 3.' }] })
    expect(parseCasesCsv('title,input,expected_behavior\n"a,b,c\n', newId)).toMatchObject({ ok: false, issues: [{ row: null, message: 'A quoted field is not closed (line 2).' }] })
    expect(parseCasesCsv('x'.repeat(LIMITS.caseImportCsvBytes + 1), newId)).toMatchObject({ ok: false, issues: [{ message: 'The file is larger than 128 KiB.' }] })
  })

  it('does not evaluate or strip formula-like text; it is plain case text', () => {
    const result = parseCasesCsv(toCsv(HEADER, [['=SUM(1)', '+1', '', '@x']]), newId)
    // toCsv neutralized the cells; the importer keeps the quote rather than guessing.
    expect(result).toMatchObject({ ok: true, cases: [{ title: "'=SUM(1)", input: "'+1", expectedBehavior: "'@x" }] })
  })
})

describe('applyImportedCases', () => {
  const draft = makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])

  it('replaces cases, keeps configurations and mode, and validates the whole draft', () => {
    const imported = parseCasesCsv(toCsv(HEADER, [row(1), row(2)]), newId)
    if (!imported.ok) throw new Error('import failed')
    const result = applyImportedCases(draft, imported.cases)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.cases.map((c) => c.title)).toEqual(['Case 1', 'Case 2'])
    expect(result.draft.configurations).toEqual(draft.configurations)
    expect(result.draft.comparisonMode).toBe('model')
  })

  it('applies the 96 KiB draft cap that per-field limits alone do not', () => {
    const big = [1, 2, 3, 4, 5].map((n) => [`Case ${n}`, 'q', '界'.repeat(LIMITS.caseReference.max), 'e'])
    const imported = parseCasesCsv(toCsv(HEADER, big), newId)
    expect(imported.ok).toBe(true) // each row is within its field limits
    if (!imported.ok) return
    expect(applyImportedCases(draft, imported.cases)).toMatchObject({ ok: false, issues: [{ message: 'Draft exceeds 96 KiB' }] })
  })
})
