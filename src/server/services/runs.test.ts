import { describe, expect, it } from 'vitest'
import { maxQuestionsFor, rotate, testimonyLimitMessage } from '../../domain/parties'
import { buildAssignment, drawPositionBase, type EligibleManifest } from './runs'

function manifest(configurationKeys: string[], caseKeys: string[]): EligibleManifest {
  return {
    caseKeys,
    excludedCaseKeys: [],
    entries: caseKeys.flatMap((caseKey) => configurationKeys.map((configurationKey) => ({ caseKey, configurationKey, generationId: `g-${caseKey}-${configurationKey}`, acceptedAttemptId: `a-${caseKey}-${configurationKey}` }))),
  }
}

describe('buildAssignment with three configurations (T24)', () => {
  it('labels A/B/C in order and covers each configuration once per case', () => {
    let n = 0
    const assignment = buildAssignment(manifest(['x', 'y', 'z'], ['c1', 'c2']), () => `id-${++n}`)
    expect(assignment.map((item) => item.caseKey)).toEqual(['c1', 'c2'])
    for (const item of assignment) {
      expect(item.responses.map((r) => r.label)).toEqual(['A', 'B', 'C'])
      expect(item.responses.map((r) => r.configurationKey).sort()).toEqual(['x', 'y', 'z'])
      for (const r of item.responses) expect(r.generationId).toBe(`g-${item.caseKey}-${r.configurationKey}`)
    }
    expect(new Set(assignment.flatMap((item) => item.responses.map((r) => r.responseId))).size).toBe(6)
  })

  it('draws all six orders with roughly equal frequency', () => {
    const counts = new Map<string, number>()
    const trials = 6_000
    for (let i = 0; i < trials; i++) {
      const [item] = buildAssignment(manifest(['x', 'y', 'z'], ['c1']), () => 'id')
      const order = item.responses.map((r) => r.configurationKey).join('')
      counts.set(order, (counts.get(order) ?? 0) + 1)
    }
    expect(counts.size).toBe(6)
    // Expected 1000 each; ±200 is > 6 standard deviations, so this never flakes.
    for (const count of counts.values()) expect(Math.abs(count - trials / 6)).toBeLessThan(200)
  })
})

describe('buildAssignment with five parties and the balanced rotation (spec 07 §9.2, D-110)', () => {
  const five = ['p1', 'p2', 'p3', 'p4', 'p5']

  it('labels A–E and, with the frozen base, puts every party in every position once over five sessions', () => {
    const base = manifest(five, ['c1', 'c2', 'c3'])
    const frozen = { ...base, positionBase: drawPositionBase(base) }
    expect(Object.keys(frozen.positionBase)).toEqual(['c1', 'c2', 'c3'])
    for (const order of Object.values(frozen.positionBase)) expect([...order].sort()).toEqual(five)
    const seen = new Map<string, Map<string, Set<string>>>() // case → party → labels
    for (let k = 0; k < 5; k++) {
      for (const item of buildAssignment(frozen, () => 'id', k)) {
        expect(item.responses.map((r) => r.label)).toEqual(['A', 'B', 'C', 'D', 'E'])
        for (const r of item.responses) {
          const byParty = seen.get(item.caseKey) ?? new Map<string, Set<string>>()
          byParty.set(r.configurationKey, (byParty.get(r.configurationKey) ?? new Set()).add(r.label))
          seen.set(item.caseKey, byParty)
        }
      }
    }
    for (const byParty of seen.values()) for (const labels of byParty.values()) expect([...labels].sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('session k sees the base rotated by k, and k wraps', () => {
    const base = manifest(five, ['c1'])
    const frozen = { ...base, positionBase: { c1: ['p3', 'p1', 'p5', 'p2', 'p4'] } }
    const order = (k: number) => buildAssignment(frozen, () => 'id', k)[0].responses.map((r) => r.configurationKey)
    expect(order(0)).toEqual(['p3', 'p1', 'p5', 'p2', 'p4'])
    expect(order(1)).toEqual(['p1', 'p5', 'p2', 'p4', 'p3'])
    expect(order(6)).toEqual(order(1))
    expect(rotate(['a', 'b'], -1)).toEqual(['b', 'a'])
  })

  it('falls back to a fresh shuffle when the base is missing or does not match the entries', () => {
    const base = manifest(['x', 'y', 'z'], ['c1'])
    for (const positionBase of [undefined, { c1: ['x', 'y'] }, { c1: ['x', 'y', 'q'] }, { c1: ['x', 'x', 'y'] }]) {
      const [item] = buildAssignment({ ...base, ...(positionBase ? { positionBase } : {}) }, () => 'id', 1)
      expect(item.responses.map((r) => r.configurationKey).sort()).toEqual(['x', 'y', 'z'])
    }
  })

  it('draws the base order at random', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 3_000; i++) {
      const order = drawPositionBase(manifest(['x', 'y', 'z'], ['c1'])).c1.join('')
      counts.set(order, (counts.get(order) ?? 0) + 1)
    }
    expect(counts.size).toBe(6)
  })
})

describe('the testimony limit (spec 07 §9.1)', () => {
  it('allows 2–3 parties on 5 questions and 4–5 on 3, and says what to remove', () => {
    expect(testimonyLimitMessage(3, 5)).toBeNull()
    expect(testimonyLimitMessage(5, 3)).toBeNull()
    expect(testimonyLimitMessage(4, 3)).toBeNull()
    expect(testimonyLimitMessage(4, 4)).toBe('4 parties × 4 questions is 16 answers for each juror to score. The limit is 15: remove a question or a party. To compare more setups, re-hear this case with an anchor party.')
    expect(testimonyLimitMessage(5, 4)).toContain('5 parties × 4 questions is 20 answers')
    expect(maxQuestionsFor(2)).toBe(5)
    expect(maxQuestionsFor(4)).toBe(3)
    expect(maxQuestionsFor(5)).toBe(3)
  })
})
