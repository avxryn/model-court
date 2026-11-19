import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TestimonySection } from '@/components/record/TestimonySection'
import { citedLines, mergeSpans, quoteFindings, splitAtSpans } from '@/lib/citations-view'
import type { ResultsView } from '@/lib/dto'
import { CitedTestimony } from './CitedTestimony'
import { SourceList } from './SourceList'

const sources = [
  { number: 1, title: 'Refunds', text: 'Customers can request a refund within 30 days of purchase.' },
  { number: 2, title: null, text: 'Refunds go back to the original card.' },
]
const ANSWER = 'You have 30 days [S1: "request a refund within 30 days"].\nIt goes back to your card [S2], see also [S9] and [S1, S7].'

describe('citation rendering (pure)', () => {
  it('chips for real sources, plain text for citations to nothing, quotes as quotations, lines kept', () => {
    const lines = citedLines(ANSWER, 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual([
      { kind: 'text', text: 'You have 30 days ' },
      { kind: 'quote', text: 'request a refund within 30 days' },
      { kind: 'ref', number: 1, exists: true, first: true, last: true },
      { kind: 'text', text: '.' },
    ])
    expect(lines[1]).toContainEqual({ kind: 'text', text: '[S9]' })
    expect(lines[1]).toContainEqual({ kind: 'ref', number: 7, exists: false, first: false, last: true })
  })

  it('quote findings, merged spans and marks (record only)', () => {
    const findings = quoteFindings('[S2, S1: "request a refund"] [S1: "within 90 days"]', sources)
    expect(findings.map((finding) => [finding.foundIn, finding.cited])).toEqual([[1, [2, 1]], [null, [1]]])
    expect(mergeSpans([{ start: 5, end: 9 }, { start: 0, end: 3 }, { start: 2, end: 6 }])).toEqual([{ start: 0, end: 9 }])
    expect(splitAtSpans('abcdef', [{ start: 1, end: 3 }])).toEqual([{ text: 'a', marked: false }, { text: 'bc', marked: true }, { text: 'def', marked: false }])
  })
})

describe('juror worksheet', () => {
  it('a testimony shows chips and quotations and no check result or highlight', () => {
    const html = renderToStaticMarkup(<CitedTestimony label="A" text={ANSWER} caseKey="q1" sources={sources} />)
    expect(html).toContain('aria-label="Source S1: Refunds"')
    expect(html).toContain('aria-label="Source S2"')
    expect(html).toContain('<q class="italic">request a refund within 30 days</q>')
    expect(html).toContain('[S9]')
    expect(html).not.toContain('aria-label="Source S9')
    for (const leak of ['found', '<mark', 'quotes-match', 'not in']) expect(html).not.toContain(leak)
  })

  it('the source list folds each source under its anchor, one open at a time, without notes', () => {
    const html = renderToStaticMarkup(<SourceList caseKey="q1" sources={sources} />)
    expect(html).toContain('id="src-q1-1"')
    expect(html).toContain('name="sources-q1"')
    expect(html).toContain('Exhibits S1–S2')
    expect(html).not.toContain('Judge’s note')
    expect(html).not.toContain('<mark')
  })
})

describe('unsealed record', () => {
  const data = {
    rubricVersion: 'grounded-v1',
    configurations: [
      { key: 'cfg-a', label: 'Setup A' },
      { key: 'cfg-b', label: 'Setup B' },
    ],
    checks: { definitions: [{ id: 'quotes-match', label: 'Quotes match their sources' }] },
    grounded: { sources: [{ caseKey: 'q1', items: sources.map((source, index) => ({ ...source, origin: index === 0 ? 'kb-1432' : null })) }] },
    cases: [
      {
        key: 'q1',
        title: 'Refunds',
        eligible: true,
        input: 'How long?',
        expectedBehavior: 'Check each claim.',
        messages: [],
        judgments: [],
        kitFields: { kind: 'grounded', answerable: 'yes', requiredSources: [1] },
        responses: [
          { configurationKey: 'cfg-a', status: 'succeeded', text: ANSWER, durationMs: 1200, inputTokens: 300, outputTokens: 40, truncated: false, checks: [{ checkId: 'quotes-match', status: 'pass', reason: 'The quote was found in its source.', detail: {} }] },
          { configurationKey: 'cfg-b', status: 'succeeded', text: 'It is 60 days [S1: "within 60 days"].', durationMs: 900, inputTokens: 300, outputTokens: 20, truncated: false, checks: [{ checkId: 'quotes-match', status: 'fail', reason: '0 of 1 quote found; the quote cited to S1 is not in S1.', detail: {} }] },
        ],
      },
    ],
  } as unknown as ResultsView

  it('shows the sources with notes, highlights found quotes, flags the one not found, and the checks', () => {
    const html = renderToStaticMarkup(<TestimonySection data={data} />)
    expect(html).toContain('Judge’s note (not sent, not shown to jurors): kb-1432')
    expect(html).toContain('<mark')
    expect(html).toContain('request a refund within 30 days</mark>')
    expect(html).toContain('not found in S1')
    expect(html).toContain('The judge marked this question: the sources answer it. A good answer cites S1.')
    expect(html).toContain('0 of 1 quote found')
  })
})
