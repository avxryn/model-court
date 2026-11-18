import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import SamplePage from '@/pages/(app)/sample'
import { FindingsSection } from './FindingsSection'
import { HeadlineSection } from './HeadlineSection'

type View = Parameters<typeof HeadlineSection>[0]['data']
const judgment = (reviewer: string, contextType: 'invited' | 'owner', configurationKey: string, s: 0 | 1 | 2) => ({ reviewer, contextType, configurationKey, correctness: s, completeness: s, grounding: s, note: '', suspectedIdentityClue: false })
const cohort = (contextType: 'invited' | 'owner', reviewerCount: number) => ({ contextType, reviewerCount, caseCount: 2, byConfiguration: null, highest: [], potentiallyUnblindedCount: 0 })
const view = (judgments: (q: number) => ReturnType<typeof judgment>[], jurors: number, judge: number): View =>
  ({
    rubricVersion: 'reference-qa-v1',
    configurations: [
      { key: 'cfg-a', label: 'Strict grounding' },
      { key: 'cfg-b', label: 'Friendly' },
    ],
    cases: [1, 2].map((q) => ({ key: `case-${q}`, title: `Question ${q}`, eligible: true, judgments: judgments(q) })),
    cohorts: { invited: cohort('invited', jurors), owner: cohort('owner', judge) },
    eligibleCaseKeys: ['case-1', 'case-2'],
    disagreements: [],
  }) as unknown as View

describe('HeadlineSection', () => {
  it('leads with the jury’s count, a head-to-head table and links to the testimony and splits', () => {
    const data = view((q) => [judgment('Juror 1', 'invited', 'cfg-a', 2), judgment('Juror 1', 'invited', 'cfg-b', q === 1 ? 0 : 2), judgment('Juror 2', 'invited', 'cfg-a', 2), judgment('Juror 2', 'invited', 'cfg-b', q === 1 ? 2 : 2), judgment('Judge (context-aware)', 'owner', 'cfg-a', 0), judgment('Judge (context-aware)', 'owner', 'cfg-b', 2)], 2, 1)
    const html = renderToStaticMarkup(<HeadlineSection data={data} />)
    expect(html).toContain('id="headline"')
    expect(html).toContain('from the jury’s scores')
    expect(html).toContain('Too close to call: Strict grounding won 1 of 2 questions and 1 tied.')
    expect(html).toContain('From 2 jurors’ worksheets, scored blind. The judge’s own review is reported on its own under Findings.')
    expect(html).toContain('href="#q-case-1"')
    expect(html).toContain('href="#splits"')
    expect(html).toContain('Head to head, question by question')
    expect(html).toMatch(/text-right tabular-nums/)
    // Jury means only: the judge's 0 for cfg-a never enters the count.
    expect(html).toContain('>12</span> of 12 points')
  })

  it('puts the judge’s own review in the headline when no juror scored, with a neutral note', () => {
    const data = view((q) => [judgment('Judge (context-aware)', 'owner', 'cfg-a', 2), judgment('Judge (context-aware)', 'owner', 'cfg-b', q === 1 ? 0 : 1)], 0, 1)
    const html = renderToStaticMarkup(<HeadlineSection data={data} />)
    expect(html).toContain('from the judge’s own review')
    expect(html).toContain('Strict grounding won 2 of 2 questions.')
    expect(html).toContain('No jurors scored this case, so this is the judge’s own review. The judge knew which setups were in the case.')
    expect(html).not.toContain('href="#splits"')
  })

  it('says plainly when there is nothing to count', () => {
    const html = renderToStaticMarkup(<HeadlineSection data={view(() => [], 0, 0)} />)
    expect(html).toContain('No worksheet was filed for this hearing')
  })
})

describe('FindingsSection', () => {
  it('reads the solo judge’s review as the result, not as a demotion', () => {
    const html = renderToStaticMarkup(<FindingsSection data={view(() => [], 0, 1)} />)
    expect(html).not.toContain('not blind')
    expect(html).toContain('No jurors scored this case, so this review is the result.')
    expect(html.indexOf('Judge’s own review (1)')).toBeLessThan(html.indexOf('Jury’s findings'))
  })

  it('keeps the jury first when jurors scored', () => {
    const html = renderToStaticMarkup(<FindingsSection data={view(() => [], 2, 1)} />)
    expect(html.indexOf('Jury’s findings (2 jurors)')).toBeLessThan(html.indexOf('Judge’s own review (1)'))
  })
})

describe('SamplePage', () => {
  it('keeps the record sealed until every testimony is scored', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SamplePage />
      </MemoryRouter>,
    )
    expect(html).toContain('0 of 10 testimonies scored · score every line to unseal')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="sample-unseal-status"[^>]*>Unseal the record<\/button>|<button[^>]*aria-describedby="sample-unseal-status"[^>]*disabled=""[^>]*>Unseal the record<\/button>/)
  })
})
