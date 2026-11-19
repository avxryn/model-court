/** Spec 07 §9.4 (D-111): the headline with four and five parties. */

import { describe, expect, it } from 'vitest'
import { pairwiseWins, tallyQuestions, type TallyJudgment } from './headline'

const parties = ['A', 'B', 'C', 'D', 'E'].map((x) => ({ key: x.toLowerCase(), label: `Party ${x}` }))
/** One rater; `scores[q][party]` is the sum over the three lines (each line gets a third, rounded into 0–2). */
function question(number: number, scores: Record<string, number>) {
  const judgments: TallyJudgment[] = Object.entries(scores).map(([configurationKey, total]) => {
    const lines = [Math.min(2, total), Math.min(2, Math.max(0, total - 2)), Math.max(0, total - 4)]
    return { reviewer: 'Juror 1', configurationKey, correctness: lines[0], completeness: lines[1], grounding: lines[2] }
  })
  return { key: `q${number}`, number, title: `Q${number}`, judgments }
}

describe('headline with four or five parties', () => {
  it('names the leader and the runner-up only', () => {
    const tally = tallyQuestions(parties, [
      question(1, { a: 2, b: 3, c: 6, d: 1, e: 0 }),
      question(2, { a: 6, b: 3, c: 2, d: 1, e: 0 }),
      question(3, { a: 1, b: 3, c: 6, d: 2, e: 0 }),
    ])
    expect(tally.outcome).toBe('close') // two wins to one is a margin of 1
    const clear = tallyQuestions(parties, [
      question(1, { a: 2, b: 3, c: 6, d: 1, e: 0 }),
      question(2, { a: 2, b: 3, c: 6, d: 1, e: 0 }),
      question(3, { a: 6, b: 3, c: 2, d: 1, e: 0 }),
      question(4, { a: 1, b: 2, c: 6, d: 3, e: 0 }),
    ] as never)
    expect(clear.outcome).toBe('lead')
    expect(clear.sentence).toBe('Party C won 3 of 4 questions; Party A won 1; the others none.')
  })

  it('says "the others fewer" when a third party also won a question', () => {
    const tally = tallyQuestions(parties, [
      question(1, { a: 1, b: 0, c: 6, d: 0, e: 0 }),
      question(2, { a: 1, b: 0, c: 6, d: 0, e: 0 }),
      question(3, { a: 1, b: 0, c: 6, d: 0, e: 0 }),
      question(4, { a: 6, b: 0, c: 1, d: 0, e: 0 }),
      question(5, { a: 1, b: 6, c: 2, d: 0, e: 0 }),
    ] as never)
    expect(tally.outcome).toBe('lead')
    expect(tally.sentence).toBe('Party C won 3 of 5 questions; Party A won 1; the others fewer.')
  })

  it('keeps three parties as before', () => {
    const three = parties.slice(0, 3)
    const tally = tallyQuestions(three, [question(1, { a: 6, b: 1, c: 2 }), question(2, { a: 6, b: 1, c: 2 }), question(3, { a: 6, b: 1, c: 2 }), question(4, { a: 1, b: 6, c: 2 })] as never)
    expect(tally.sentence).toBe('Party A won 3 of 4 questions; Party B won 1.')
  })

  it('names no winner on a three-way tie', () => {
    const tally = tallyQuestions(parties, [question(1, { a: 6, b: 6, c: 6, d: 1, e: 0 }), question(2, { a: 6, b: 6, c: 6, d: 1, e: 0 })])
    expect(tally.outcome).toBe('tie')
    expect(tally.leader).toBeNull()
    expect(tally.questions.every((q) => q.winner === null)).toBe(true)
  })

  it('pairwise: row beat column on k of n, ties for neither', () => {
    const tally = tallyQuestions(parties, [question(1, { a: 2, b: 3, c: 6, d: 1, e: 0 }), question(2, { a: 6, b: 3, c: 6, d: 1, e: 0 }), question(3, { a: 1, b: 3, c: 6, d: 2, e: 0 })])
    const { beats, questions } = pairwiseWins(tally)
    expect(questions).toBe(3)
    expect(beats.c.a).toBe(2)
    expect(beats.a.c).toBe(0) // the tie on Q2 counts for neither
    expect(beats.b.a).toBe(2)
    expect(beats.a.b).toBe(1)
    for (const row of parties) for (const col of parties) if (row.key !== col.key) expect(beats[row.key][col.key] + beats[col.key][row.key]).toBeLessThanOrEqual(3)
    expect(beats.e.d).toBe(0)
    expect(beats.d.e).toBe(3)
  })
})
