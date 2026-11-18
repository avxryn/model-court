import { describe, expect, it } from 'vitest'
import { findSplits } from './DisagreementSection'

type Judgment = { reviewer: string; contextType: 'invited' | 'guest' | 'owner'; configurationKey: string; correctness: 0 | 1 | 2 | null; completeness: 0 | 1 | 2 | null; grounding: 0 | 1 | 2 | null; note: string; suspectedIdentityClue: boolean }
const j = (reviewer: string, configurationKey: string, scores: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2], extra: Partial<Judgment> = {}): Judgment => ({ reviewer, contextType: 'invited', configurationKey, correctness: scores[0], completeness: scores[1], grounding: scores[2], note: '', suspectedIdentityClue: false, ...extra })
const data = (cases: Array<{ key: string; title: string; judgments: Judgment[] }>) => ({ cases }) as unknown as Parameters<typeof findSplits>[0]

describe('findSplits', () => {
  it('lists two-point splits and identity flags, most contested first', () => {
    const result = findSplits(
      data([
        { key: 'q1', title: 'Calm', judgments: [j('Juror 1', 'a', [2, 2, 2]), j('Juror 2', 'a', [2, 1, 2])] },
        { key: 'q2', title: 'Flagged', judgments: [j('Juror 1', 'a', [2, 2, 2], { suspectedIdentityClue: true }), j('Juror 2', 'a', [2, 2, 2])] },
        { key: 'q3', title: 'Split twice', judgments: [j('Juror 1', 'a', [0, 2, 0]), j('Juror 2', 'a', [2, 2, 2]), j('Guest 1', 'b', [1, 1, 1], { contextType: 'guest' })] },
      ]),
    )
    expect(result.jurors).toBe(3)
    expect(result.contested.map((q) => q.key)).toEqual(['q3', 'q2'])
    expect(result.contested[0].splits).toEqual([
      { configurationKey: 'a', dimension: 'correctness', low: 0, high: 2 },
      { configurationKey: 'a', dimension: 'grounding', low: 0, high: 2 },
    ])
    expect(result.contested[1].flags).toBe(1)
    expect(result.nearOnly).toBe(1)
  })

  it("ignores the judge's own context-aware review", () => {
    const result = findSplits(data([{ key: 'q1', title: 'One juror', judgments: [j('Juror 1', 'a', [0, 0, 0]), j('You', 'a', [2, 2, 2], { contextType: 'owner' })] }]))
    expect(result.jurors).toBe(1)
    expect(result.contested).toEqual([])
  })
})
