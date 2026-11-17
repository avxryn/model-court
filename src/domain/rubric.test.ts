import { describe, expect, it } from 'vitest'
import { findDisagreements, scoreCohort, submissionIssues, type CompleteRating, type ScoredSession } from './rubric'
import type { Score } from './contracts'

const A = 'cfg-a'
const B = 'cfg-b'

function rating(responseId: string, score: Score, note = ''): CompleteRating {
  return { responseId, correctness: score, completeness: score, grounding: score, note, suspectedIdentityClue: false }
}

function session(id: string, contextType: 'invited' | 'owner', scores: Record<string, [Score, Score]>): ScoredSession {
  const responses: ScoredSession['responses'] = []
  const ratings: CompleteRating[] = []
  for (const [caseKey, [a, b]] of Object.entries(scores)) {
    responses.push({ caseKey, responseId: `${id}-${caseKey}-a`, configurationKey: A })
    responses.push({ caseKey, responseId: `${id}-${caseKey}-b`, configurationKey: B })
    ratings.push(rating(`${id}-${caseKey}-a`, a), rating(`${id}-${caseKey}-b`, b))
  }
  return { sessionId: id, contextType, identityClueFlag: false, responses, ratings }
}

describe('scoreCohort — spec §11.4 fixture (T14)', () => {
  const eligible = ['c1', 'c2']
  const sessions = [
    session('r1', 'invited', { c1: [2, 1], c2: [2, 1] }),
    session('r2', 'invited', { c1: [2, 1], c2: [2, 1] }),
    session('owner', 'owner', { c1: [2, 2], c2: [2, 2] }),
  ]

  it('computes exact invited means and keeps the owner cohort separate', () => {
    const invited = scoreCohort('invited', eligible, [A, B], sessions)
    expect(invited.reviewerCount).toBe(2)
    expect(invited.caseCount).toBe(2)
    expect(invited.byConfiguration?.[A].dimensions.correctness.mean).toBe(2)
    expect(invited.byConfiguration?.[A].overallMean).toBe(2)
    expect(invited.byConfiguration?.[B].overallMean).toBe(1)
    expect(invited.highest).toEqual([A])

    const owner = scoreCohort('owner', eligible, [A, B], sessions)
    expect(owner.reviewerCount).toBe(1)
    expect(owner.byConfiguration?.[B].overallMean).toBe(2)
    expect(owner.highest).toEqual([A, B])
  })

  it('reports "no reviews" (null), never zero, for an empty cohort', () => {
    const result = scoreCohort('invited', eligible, [A, B], [sessions[2]])
    expect(result.reviewerCount).toBe(0)
    expect(result.byConfiguration).toBeNull()
    expect(result.highest).toEqual([])
  })

  it('detects exact ties on unrounded totals', () => {
    const tie = [session('r1', 'invited', { c1: [2, 1], c2: [1, 2] })]
    expect(scoreCohort('invited', eligible, [A, B], tie).highest).toEqual([A, B])
  })

  it('does not round near-ties into ties', () => {
    // A: 2+2+2 + 1+1+1 over 2 cases; B: 2+2+2 + 1+1+0 → differs by one point.
    const s = session('r1', 'invited', { c1: [2, 2], c2: [1, 1] })
    s.ratings[3] = { ...s.ratings[3], grounding: 0 }
    const result = scoreCohort('invited', eligible, [A, B], [s])
    expect(result.byConfiguration?.[A].overallSum).toBe(9)
    expect(result.byConfiguration?.[B].overallSum).toBe(8)
    expect(result.highest).toEqual([A])
  })

  it('throws when a session lacks a rating rather than shrinking the denominator', () => {
    const s = session('r1', 'invited', { c1: [2, 1], c2: [2, 1] })
    s.ratings.pop()
    expect(() => scoreCohort('invited', eligible, [A, B], [s])).toThrow()
  })
})

describe('findDisagreements', () => {
  it('flags max − min ≥ 1 across two invited reviewers only', () => {
    const sessions = [
      session('r1', 'invited', { c1: [2, 1] }),
      session('r2', 'invited', { c1: [2, 2] }),
      session('owner', 'owner', { c1: [0, 0] }),
    ]
    const found = findDisagreements(sessions)
    expect(found).toHaveLength(3)
    expect(found.every((d) => d.configurationKey === B && d.min === 1 && d.max === 2)).toBe(true)
  })

  it('needs at least two invited reviewers', () => {
    expect(findDisagreements([session('r1', 'invited', { c1: [0, 2] })])).toEqual([])
  })
})

describe('submissionIssues', () => {
  const assigned = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
  const full = (id: string, score: Score, note = '') => ({ ...rating(id, score, note) })

  it('accepts a complete set', () => {
    expect(submissionIssues(assigned, [full(assigned[0], 2), full(assigned[1], 1)])).toEqual([])
  })

  it('rejects a forged rating for an unassigned response (hidden extra rating fixture)', () => {
    const forged = full('33333333-3333-4333-8333-333333333333', 2)
    const issues = submissionIssues(assigned, [full(assigned[0], 2), full(assigned[1], 1), forged])
    expect(issues).toContainEqual({ kind: 'unknown_response', responseId: forged.responseId })
  })

  it('requires every dimension and a 10+ character note for any zero', () => {
    const partial = { ...full(assigned[0], 2), grounding: null }
    const zero = full(assigned[1], 0, 'too short')
    const issues = submissionIssues(assigned, [partial, zero])
    expect(issues).toContainEqual({ kind: 'missing_score', responseId: assigned[0], dimension: 'grounding' })
    expect(issues).toContainEqual({ kind: 'note_required', responseId: assigned[1] })
    expect(submissionIssues(assigned, [full(assigned[0], 2), full(assigned[1], 0, 'Invents a refund exception.')])).toEqual([])
  })

  it('reports missing responses', () => {
    expect(submissionIssues(assigned, [full(assigned[0], 2)])).toContainEqual({ kind: 'missing_response', responseId: assigned[1] })
  })
})

describe('T24 three configurations score on common cases', () => {
  const C = 'cfg-c'
  function session3(id: string, contextType: 'invited' | 'owner', scores: Record<string, [Score, Score, Score]>): ScoredSession {
    const responses: ScoredSession['responses'] = []
    const ratings: CompleteRating[] = []
    for (const [caseKey, triple] of Object.entries(scores)) {
      ;[A, B, C].forEach((configurationKey, index) => {
        const responseId = `${id}-${caseKey}-${index}`
        responses.push({ caseKey, responseId, configurationKey })
        ratings.push(rating(responseId, triple[index]))
      })
    }
    return { sessionId: id, contextType, identityClueFlag: false, responses, ratings }
  }

  it('uses one denominator per configuration and finds the single highest', () => {
    const sessions = [session3('r1', 'invited', { c1: [2, 1, 0], c2: [1, 1, 2] }), session3('r2', 'invited', { c1: [2, 2, 1], c2: [2, 0, 2] })]
    const result = scoreCohort('invited', ['c1', 'c2'], [A, B, C], sessions)
    expect(result.byConfiguration?.[A].overallMean).toBe(7 / 4)
    expect(result.byConfiguration?.[B].overallMean).toBe(1)
    expect(result.byConfiguration?.[C].overallMean).toBe(5 / 4)
    for (const key of [A, B, C]) expect(result.byConfiguration?.[key].dimensions.grounding.count).toBe(4)
    expect(result.highest).toEqual([A])
  })

  it('reports a three-way exact tie and a two-of-three tie', () => {
    expect(scoreCohort('invited', ['c1'], [A, B, C], [session3('r1', 'invited', { c1: [1, 1, 1] })]).highest).toEqual([A, B, C])
    expect(scoreCohort('invited', ['c1'], [A, B, C], [session3('r1', 'invited', { c1: [2, 0, 2] })]).highest).toEqual([A, C])
  })

  it('ignores cases outside the common (eligible) set', () => {
    const sessions = [session3('r1', 'invited', { c1: [2, 2, 2], c2: [0, 0, 0] })]
    const result = scoreCohort('invited', ['c1'], [A, B, C], sessions)
    expect(result.caseCount).toBe(1)
    expect(result.byConfiguration?.[C].overallMean).toBe(2)
  })

  it('finds disagreements on the third configuration', () => {
    const sessions = [session3('r1', 'invited', { c1: [2, 2, 2] }), session3('r2', 'invited', { c1: [2, 2, 0] })]
    const disagreements = findDisagreements(sessions)
    expect(disagreements.map((d) => d.configurationKey)).toEqual([C, C, C])
  })
})
