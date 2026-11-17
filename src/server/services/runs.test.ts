import { describe, expect, it } from 'vitest'
import { buildAssignment, type EligibleManifest } from './runs'

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
