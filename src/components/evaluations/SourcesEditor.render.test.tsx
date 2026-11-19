import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CaseInput } from '@/domain/contracts'
import { estimateGroundedInput, GROUNDED_TEMPLATE_BYTES } from '@/domain/grounded/estimate'
import { makeExampleDraft } from '@/domain/example'
import { buildGroundedV1 } from '@/domain/messages'
import { utf8ByteLength } from '@/domain/text'
import { switchKit } from '@/lib/kits'
import { remapRequired, rowProblems, rowsChanged, rowsOf, sourcesOf } from '@/lib/sources'
import { CASE_TEMPLATES } from '@/lib/templates'
import { GroundedQuestionFields, GroundedSourcesProvider } from './SourcesEditor'

let n = 0
const newId = () => `row-${++n}`
const saved = [
  { number: 1, title: 'Refunds', origin: 'kb-1', text: 'Refunds take 5 days.' },
  { number: 2, title: null, origin: null, text: 'Returns within 30 days.' },
  { number: 3, title: 'Warranty', origin: null, text: 'One year.' },
]

describe('sources editor rules', () => {
  it('rows round-trip to the PUT body, numbered by position, blank title and note left out', () => {
    const rows = rowsOf(saved, newId)
    expect(rowsChanged(rows, saved)).toBe(false)
    expect(sourcesOf(rows)).toEqual([
      { number: 1, title: 'Refunds', origin: 'kb-1', text: 'Refunds take 5 days.' },
      { number: 2, text: 'Returns within 30 days.' },
      { number: 3, title: 'Warranty', text: 'One year.' },
    ])
  })

  it('moving a source carries its tick; removing one drops it and names it', () => {
    const rows = rowsOf(saved, newId)
    const moved = [rows[2], rows[0], rows[1]]
    expect(rowsChanged(moved, saved)).toBe(true)
    expect(remapRequired([1, 3], moved)).toEqual({ required: [1, 2], dropped: [] })
    expect(remapRequired([1, 3], [rows[0], rows[1]])).toEqual({ required: [1], dropped: [3] })
    expect(remapRequired([2], [...rows, { id: 'x', savedNumber: null, title: '', text: 'new', origin: '' }])).toEqual({ required: [2], dropped: [] })
  })

  it('reports blank text, long text, multi-line titles and the totals', () => {
    const row = (text: string, title = '') => ({ id: newId(), savedNumber: null, title, text, origin: '' })
    expect(rowProblems([], 0)).toEqual(['Add at least one source.'])
    expect(rowProblems([row(' ')], 0)).toEqual(['S1 has no text.'])
    expect(rowProblems([row('x'.repeat(6001))], 0)[0]).toBe('S1 is 6,001 characters; at most 6,000.')
    expect(rowProblems([row('a', 'two\nlines')], 0)).toEqual(["S1's title must be one line."])
    expect(rowProblems([row('x'.repeat(6000))], 55_000)).toEqual(["With the other questions the case's sources would be 61,000 characters; at most 60,000."])
  })
})

describe('switching to Answers from sources', () => {
  it('clears exhibits with a note and gives every question the default key', () => {
    const draft = makeExampleDraft(() => crypto.randomUUID(), ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
    const result = switchKit(draft, 'grounded-v1')
    expect(result.draft.cases.every((testCase) => testCase.reference === '')).toBe(true)
    expect(result.draft.cases.every((testCase) => JSON.stringify(testCase.kitFields) === JSON.stringify({ kind: 'grounded', answerable: 'yes', requiredSources: [] }))).toBe(true)
    expect(result.draft.rubricVersion).toBe('grounded-v1')
    expect(result.removals.some((line) => line.includes('keeps each question’s evidence as numbered sources') || line.includes("keeps each question's evidence as numbered sources"))).toBe(true)
  })
})

describe('the start estimate', () => {
  it('counts each source once per call, party and sample, and the template wording', () => {
    const minimal = buildGroundedV1({ systemPrompt: '', prompt: { reference: '', input: '' }, settings: {}, sources: [{ number: 1, title: null, text: '' }] })!
    expect(utf8ByteLength(minimal.messages[0].content)).toBeLessThanOrEqual(GROUNDED_TEMPLATE_BYTES)
    const draft = makeExampleDraft(() => crypto.randomUUID(), ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
    const cases = draft.cases.slice(0, 1).map((testCase) => ({ ...testCase, kitFields: { kind: 'grounded' as const, answerable: 'yes' as const, requiredSources: [], sources: [{ number: 1, sha256: 'a'.repeat(64), byteLength: 4000 }] } }))
    const one = estimateGroundedInput(cases, draft.configurations, 1)
    expect(one.calls).toBe(2)
    expect(one.perCall[0].tokens).toBeGreaterThan(1000)
    expect(estimateGroundedInput(cases, draft.configurations, 3).total).toBe(one.total * 3)
  })
})

describe('GroundedQuestionFields', () => {
  const testCase: CaseInput = { key: '00000000-0000-4000-8000-000000000071', title: 'Refunds', input: 'How long?', reference: '', expectedBehavior: 'Check.', kitFields: { kind: 'grounded', answerable: 'yes', requiredSources: [1] } }
  const render = (value: Parameters<typeof GroundedSourcesProvider>[0]['value'], fields = testCase) =>
    renderToStaticMarkup(
      <GroundedSourcesProvider value={value}>
        <GroundedQuestionFields testCase={fields} index={0} errors={{}} onChange={() => {}} />
      </GroundedSourcesProvider>,
    )

  it('shows the sources, the plain line about who gets them, the key and the ticks', () => {
    const html = render({ evaluationId: 'e', revision: 3, saved: true, sources: [{ caseKey: testCase.key, items: saved }], onSaved: () => {} })
    expect(html).toContain('Exhibits S1–S3')
    expect(html).toContain('Sources are sent to every party’s provider and shown to your jurors.')
    expect(html).toContain('Can the sources answer this?')
    expect(html).toContain('A good answer cites')
    expect(html).toContain('Returns within 30 days.')
    expect(html).toContain('about 1 minute of reading for each juror')
  })

  it('asks for a saved draft first, and hides the ticks when the answer is No', () => {
    const html = render({ evaluationId: 'e', revision: 3, saved: false, sources: [], onSaved: () => {} }, { ...testCase, kitFields: { kind: 'grounded', answerable: 'no', requiredSources: [] } })
    expect(html).toContain('Save the draft, then add or change this question’s sources.')
    expect(html).not.toContain('A good answer cites')
  })

  it('the template starter is a valid grounded case with sources for every question', () => {
    const template = CASE_TEMPLATES.find((candidate) => candidate.id === 'sources')!
    expect(template.sources).toHaveLength(3)
    const applied = template.apply!(makeExampleDraft(() => crypto.randomUUID(), ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5']), () => crypto.randomUUID())
    expect(applied.cases.map((c) => (c.kitFields as { answerable: string }).answerable)).toEqual(['yes', 'partly', 'no'])
  })
})
