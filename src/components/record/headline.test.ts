import { describe, expect, it } from 'vitest'
import { formatPoints, recordTally, tallyQuestions, type TallyQuestionInput } from './headline'

const parties = [
  { key: 'a', label: 'Strict grounding' },
  { key: 'b', label: 'Friendly' },
]

type Points = [number, number, number]
/** One question; each entry is one rater's lines for party a and party b. */
const question = (n: number, raters: Array<[Points, Points]>): TallyQuestionInput => ({
  key: `q${n}`,
  number: n,
  title: `Question ${n}`,
  judgments: raters.flatMap(([a, b], i) => [
    { reviewer: `Juror ${i + 1}`, configurationKey: 'a', correctness: a[0], completeness: a[1], grounding: a[2] },
    { reviewer: `Juror ${i + 1}`, configurationKey: 'b', correctness: b[0], completeness: b[1], grounding: b[2] },
  ]),
})
const solo = (n: number, a: Points, b: Points) => question(n, [[a, b]])
const win: [Points, Points] = [[2, 2, 2], [0, 1, 0]]
const lose: [Points, Points] = [[1, 1, 1], [2, 2, 2]]
const tie: [Points, Points] = [[2, 1, 2], [2, 2, 1]]

describe('tallyQuestions', () => {
  it('names the leader of a clear win and counts single-point questions', () => {
    const qs = [...Array.from({ length: 5 }, (_, i) => solo(i + 1, ...win)), solo(6, [2, 2, 2], [2, 2, 1]), solo(7, ...lose), ...[8, 9, 10].map((n) => solo(n, ...tie))]
    const t = tallyQuestions(parties, qs)
    expect(t.outcome).toBe('lead')
    expect(t.leader).toBe('a')
    expect(t.sentence).toBe('Strict grounding won 6 of 10 questions; Friendly won 1; 3 tied.')
    expect(t.parties.map((p) => [p.wins, p.ties, p.losses])).toEqual([
      [6, 3, 1],
      [1, 3, 6],
    ])
    expect(t.parties.map((p) => p.total)).toEqual([5 * 6 + 6 + 3 + 3 * 5, 5 * 1 + 5 + 6 + 3 * 5])
    expect(t.totalLeader).toBe('a')
    expect(t.totalMargin).toBe(54 - 31)
    expect(t.maxTotal).toBe(60)
    expect(t.close.map((q) => q.number)).toEqual([6])
    expect(t.questions[0]).toMatchObject({ winner: 'a', margin: 5 })
    expect(t.questions[7]).toMatchObject({ winner: null, margin: 0 })
  })

  it('omits a party that won nothing', () => {
    const t = tallyQuestions(parties, [solo(1, ...win), solo(2, ...win), solo(3, ...tie)])
    expect(t.sentence).toBe('Strict grounding won 2 of 3 questions; 1 tied.')
  })

  it('calls a one-question lead too close instead of naming a winner', () => {
    const t = tallyQuestions(parties, [solo(1, ...win), solo(2, ...win), solo(3, ...lose), ...[4, 5].map((n) => solo(n, ...tie))])
    expect(t.outcome).toBe('close')
    expect(t.leader).toBeNull()
    expect(t.sentence).toBe('Too close to call: Strict grounding won 2 of 5 questions, Friendly won 1 and 2 tied.')
  })

  it('says so when question wins and point totals point different ways', () => {
    const narrow: [Points, Points] = [[2, 2, 1], [2, 1, 1]]
    const big: [Points, Points] = [[0, 0, 0], [2, 2, 2]]
    const t = tallyQuestions(parties, [solo(1, ...narrow), solo(2, ...narrow), solo(3, ...narrow), solo(4, ...big)])
    expect(t.outcome).toBe('close')
    expect(t.totalLeader).toBe('b')
    expect(t.sentence).toBe('Too close to call: Strict grounding won 3 of 4 questions and Friendly won 1. But Friendly scored more points overall.')
    expect(t.close).toHaveLength(3)
  })

  it('reports all ties as a tie', () => {
    const t = tallyQuestions(parties, [solo(1, ...tie), solo(2, [0, 0, 0], [0, 0, 0])])
    expect(t.outcome).toBe('tie')
    expect(t.leader).toBeNull()
    expect(t.totalLeader).toBeNull()
    expect(t.sentence).toBe('A tie: all 2 questions scored the same for both parties.')
    expect(t.close).toEqual([])
  })

  it('reports equal wins and equal totals as a tie', () => {
    const t = tallyQuestions(parties, [solo(1, [2, 2, 2], [2, 2, 1]), solo(2, [2, 2, 1], [2, 2, 2])])
    expect(t.outcome).toBe('tie')
    expect(t.sentence).toBe('A tie: each party won 1 of 2 questions and the totals are equal.')
  })

  it('averages jurors per question', () => {
    const t = tallyQuestions(parties, [
      question(1, [
        [[2, 2, 2], [1, 1, 1]],
        [[1, 1, 1], [2, 1, 1]],
      ]),
    ])
    expect(t.raters).toBe(2)
    expect(t.questions[0].scores).toEqual({ a: 4.5, b: 3.5 })
    expect(t.questions[0]).toMatchObject({ winner: 'a', margin: 1 })
    expect(t.close).toHaveLength(1)
  })

  it('leaves out questions with an incomplete rating and says when nothing is scored', () => {
    const full = solo(2, [2, 2, 2], [2, 2, 2])
    const partial = { ...full, judgments: full.judgments.map((j, i) => (i === 1 ? { ...j, grounding: null } : j)) }
    expect(tallyQuestions(parties, [partial]).outcome).toBe('none')
    expect(tallyQuestions(parties, [solo(1, ...win), partial]).questions.map((q) => q.key)).toEqual(['q1'])
  })
})

describe('recordTally', () => {
  const judgment = (reviewer: string, contextType: 'invited' | 'owner', configurationKey: string, s: number) => ({ reviewer, contextType, configurationKey, correctness: s, completeness: s, grounding: s, note: '', suspectedIdentityClue: false })
  const data = (judgments: ReturnType<typeof judgment>[], eligible = true) =>
    ({ configurations: parties, cases: [{ key: 'c1', title: 'One', eligible, judgments }] }) as unknown as Parameters<typeof recordTally>[0]

  it('uses the judge’s own review in a solo case', () => {
    const t = recordTally(data([judgment('Judge (context-aware)', 'owner', 'a', 2), judgment('Judge (context-aware)', 'owner', 'b', 1)]))
    expect(t.source).toBe('judge')
    expect(t.questions[0].scores).toEqual({ a: 6, b: 3 })
  })

  it('never mixes the judge’s review into the jury’s', () => {
    const t = recordTally(data([judgment('Juror 1', 'invited', 'a', 0), judgment('Juror 1', 'invited', 'b', 2), judgment('Judge (context-aware)', 'owner', 'a', 2), judgment('Judge (context-aware)', 'owner', 'b', 0)]))
    expect(t.source).toBe('jury')
    expect(t.raters).toBe(1)
    expect(t.questions[0].scores).toEqual({ a: 0, b: 6 })
  })

  it('counts only eligible questions and numbers them as the record does', () => {
    const view = { configurations: parties, cases: [{ key: 'x', title: 'Excluded', eligible: false, judgments: [] }, { key: 'y', title: 'Kept', eligible: true, judgments: [judgment('Juror 1', 'invited', 'a', 1), judgment('Juror 1', 'invited', 'b', 1)] }] } as unknown as Parameters<typeof recordTally>[0]
    const t = recordTally(view)
    expect(t.questions.map((q) => [q.key, q.number])).toEqual([['y', 2]])
  })

  it('has no source without any worksheet', () => {
    expect(recordTally(data([])).source).toBe('none')
  })
})

describe('formatPoints', () => {
  it('shows whole points plainly and means to one decimal', () => {
    expect(formatPoints(6)).toBe('6')
    expect(formatPoints(14 / 3)).toBe('4.7')
    expect(formatPoints(4.5)).toBe('4.5')
  })
})
