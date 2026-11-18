import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DisagreementSection } from './DisagreementSection'

const judgment = (reviewer: string, correctness: 0 | 1 | 2) => ({ reviewer, contextType: 'invited', configurationKey: 'cfg-a', correctness, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })
const data = {
  rubricVersion: undefined,
  configurations: [{ key: 'cfg-a', label: 'Support bot v2' }],
  cases: [{ key: 'case-1', title: 'Outside the return window', judgments: [judgment('Juror 1', 0), judgment('Juror 2', 2)] }],
} as unknown as Parameters<typeof DisagreementSection>[0]['data']

describe('DisagreementSection', () => {
  it('names the question, the line and the party, and links to its testimony', () => {
    const html = renderToStaticMarkup(<DisagreementSection data={data} />)
    expect(html).toContain('Where the jury split')
    expect(html).toContain('Q1: Outside the return window')
    expect(html).toContain('Support bot v2')
    expect(html).toMatch(/0 vs 2/)
    expect(html).toContain('href="#q-case-1"')
  })
})
