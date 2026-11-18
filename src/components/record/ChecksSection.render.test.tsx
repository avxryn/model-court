import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ResultsView } from '@/lib/dto'
import { ChecksSection, ChecksTable, countsText, labelRows } from './ChecksSection'
import { CHECKS_FIXTURE } from './checks.fixture'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('ChecksSection', () => {
  it('opens with the plain disclaimer, then metrics, the per-check table and label lines', () => {
    const html = renderToStaticMarkup(<ChecksSection data={CHECKS_FIXTURE} />)
    const plain = text(html)
    expect(html).toContain('id="checks"')
    expect(plain).toContain('Checks Model Court ran on each answer, at no extra cost (Classification kit). They are not part of the jury’s findings.')
    expect(plain).toContain('Matched the expected label')
    expect(plain).toContain('4 of 5 questions')
    expect(plain).toContain('one question moves this by 20 percentage points')
    expect(plain).toContain('Passed every check')
    expect(plain).toContain('4 of 5 passed')
    expect(plain).toContain('4 of 4 passed · 1 could not run')
    expect(plain).toContain('Lower is better.')
    expect(plain).toContain('Q4 Feature request Bug Does not match Feature request Matches')
    expect(plain).toContain('Q3 Account access Account access Matches No allowed label Does not match')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })

  it('renders nothing for a hearing without checks', () => {
    expect(renderToStaticMarkup(<ChecksSection data={{ ...CHECKS_FIXTURE, checks: null, kit: null } as ResultsView} />)).toBe('')
  })

  it('says when a check never applied, and shows repeats per sample', () => {
    expect(countsText({ pass: 0, fail: 0, na: 5, error: 0 })).toBe('Did not apply')
    expect(countsText({ pass: 2, fail: 1, na: 1, error: 0 })).toBe('2 of 3 passed · 1 does not apply')
    const withSamples = { ...CHECKS_FIXTURE, checks: { ...CHECKS_FIXTURE.checks!, allPassedSamples: { 'cfg-a': { numerator: 7, denominator: 10 } } } } as ResultsView
    expect(text(renderToStaticMarkup(<ChecksSection data={withSamples} />))).toContain('Terse prompt passed every check in 7 of 10 samples')
  })

  it('label rows say right or wrong per party', () => {
    const rows = labelRows(CHECKS_FIXTURE, CHECKS_FIXTURE.configurations)
    expect(rows[3]).toMatchObject({ number: 4, expected: 'Feature request', said: { 'cfg-a': { label: 'Bug', correct: false }, 'cfg-b': { label: 'Feature request', correct: true } } })
    expect(labelRows({ ...CHECKS_FIXTURE, kit: { version: 'summarization-v1', name: 'Summaries', settings: {} } } as ResultsView, CHECKS_FIXTURE.configurations)).toEqual([])
  })

  it('the printable table drops descriptions', () => {
    const html = renderToStaticMarkup(<ChecksTable checks={CHECKS_FIXTURE.checks!} parties={CHECKS_FIXTURE.configurations} print />)
    expect(html).toContain('Names one allowed label')
    expect(html).not.toContain('case, quotes, emphasis')
  })
})
