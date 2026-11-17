import { describe, expect, it } from 'vitest'
import type { CompleteRating, ScoredSession } from '../../domain/rubric'
import { languageBreakdown } from './results'

describe('languageBreakdown (D-36)', () => {
  const cases = [
    { key: 'q1', language: 'en' },
    { key: 'q2', language: 'es' },
    { key: 'q3' },
    { key: 'q4', language: 'en' },
  ]
  const rating = (responseId: string, score: 0 | 1 | 2): CompleteRating => ({ responseId, correctness: score, completeness: score, grounding: score, note: score === 0 ? 'A note long enough.' : '', suspectedIdentityClue: false })
  const session: ScoredSession = {
    sessionId: 's1',
    contextType: 'invited',
    identityClueFlag: false,
    responses: cases.flatMap((c) => [
      { caseKey: c.key, responseId: `${c.key}-a`, configurationKey: 'A' },
      { caseKey: c.key, responseId: `${c.key}-b`, configurationKey: 'B' },
    ]),
    ratings: cases.flatMap((c) => [rating(`${c.key}-a`, c.language === 'en' ? 2 : 1), rating(`${c.key}-b`, 1)]),
  }

  it('groups eligible questions by tag, untagged last, and scores each group on its own questions', () => {
    const groups = languageBreakdown(cases, ['q1', 'q2', 'q3', 'q4'], ['A', 'B'], [session])
    expect(groups.map((g) => [g.language, g.caseKeys])).toEqual([
      ['en', ['q1', 'q4']],
      ['es', ['q2']],
      [null, ['q3']],
    ])
    expect(groups[0].invited.byConfiguration!.A.overallMean).toBe(2)
    expect(groups[1].invited.byConfiguration!.A.overallMean).toBe(1)
    expect(groups[0].owner.byConfiguration).toBeNull()
  })

  it('ignores ineligible questions and returns nothing with fewer than two tags', () => {
    expect(languageBreakdown(cases, ['q1', 'q3', 'q4'], ['A', 'B'], [session])).toEqual([])
    expect(languageBreakdown([{ key: 'q1' }, { key: 'q2' }], ['q1', 'q2'], ['A', 'B'], [])).toEqual([])
  })
})
