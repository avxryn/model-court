import { describe, expect, it } from 'vitest'
import { consistencyMetrics, jaccard, normalizeAnswer, questionConsistency, trigrams, type SampleText } from './consistency'

const ok = (text: string, outputTokens: number | null = 10, durationMs: number | null = 1000): SampleText => ({ status: 'succeeded', text, outputTokens, durationMs })
const failed: SampleText = { status: 'failed', text: null, outputTokens: null, durationMs: 40 }

describe('normalization and overlap', () => {
  it('normalizes NFC, trims and collapses whitespace', () => {
    expect(normalizeAnswer('  Café  au \n\t lait ')).toBe('Café au lait')
  })
  it('scores identical text 1 and disjoint text 0', () => {
    expect(jaccard(trigrams('Returns within 30 days.'), trigrams('Returns within 30 days.'))).toBe(1)
    expect(jaccard(trigrams('aaaa'), trigrams('zzzz'))).toBe(0)
    expect(jaccard(trigrams(''), trigrams(''))).toBe(1)
    expect(jaccard(trigrams('ab'), trigrams('ab'))).toBe(1)
  })
  it('works on text without spaces (CJK)', () => {
    const a = trigrams('返品は三十日以内に可能です')
    const b = trigrams('返品は三十日以内なら可能です')
    const overlap = jaccard(a, b)
    expect(overlap).toBeGreaterThan(0.4)
    expect(overlap).toBeLessThan(1)
  })
})

describe('questionConsistency', () => {
  it('treats whitespace-only differences as the same answer', () => {
    const q = questionConsistency({ caseKey: 'q', planned: 2, samples: [ok('Yes, within 30 days.'), ok('Yes,  within 30 days.\n')] })
    expect(q).toMatchObject({ n: 2, same: true, overlap: 1, answeredEveryTime: true })
  })

  it('averages every pair with three samples and reports the length spread', () => {
    const q = questionConsistency({ caseKey: 'q', planned: 3, samples: [ok('alpha beta', 10), ok('alpha beta', 20), ok('gamma delta', 30)] })
    expect(q.same).toBe(false)
    // Pairs: (1,2) = 1, (1,3) = 0, (2,3) = 0 → mean 1/3.
    expect(q.overlap).toBeCloseTo(1 / 3, 5)
    expect(q.lengthSpread).toBe(1) // (30 − 10) / 20
  })

  it('handles partial failures and empty input', () => {
    expect(questionConsistency({ caseKey: 'q', planned: 3, samples: [ok('a'), failed, ok('a')] })).toMatchObject({ n: 2, same: true, answeredEveryTime: false })
    expect(questionConsistency({ caseKey: 'q', planned: 2, samples: [ok('a'), failed] })).toMatchObject({ n: 1, same: null, overlap: null, lengthSpread: null, answeredEveryTime: false })
    expect(questionConsistency({ caseKey: 'q', planned: 2, samples: [] })).toMatchObject({ n: 0, same: null, answeredEveryTime: false })
  })
})

describe('consistencyMetrics', () => {
  it('summarizes a party across questions', () => {
    const m = consistencyMetrics([
      { caseKey: 'q1', planned: 2, samples: [ok('same', 10, 1000), ok('same', 10, 1200)] },
      { caseKey: 'q2', planned: 2, samples: [ok('one thing', 10, 1100), ok('another', 30, 3300)] },
      { caseKey: 'q3', planned: 2, samples: [ok('only', 10, 900), failed] },
    ])
    expect(m).toMatchObject({ compared: 2, sameAnswer: 1, answeredEveryTime: 2, planned: 3 })
    expect(m.medianOverlap).toBeGreaterThan(0)
    expect(m.medianOverlap).toBeLessThan(1)
    // Durations 900, 1000, 1100, 1200, 3300 → slowest / median = 3300 / 1100.
    expect(m.latencySpread).toBeCloseTo(3, 5)
    expect(m.questions).toHaveLength(3)
  })

  it('is empty without questions', () => {
    expect(consistencyMetrics([])).toMatchObject({ compared: 0, sameAnswer: 0, medianOverlap: null, answeredEveryTime: 0, planned: 0, latencySpread: null })
  })
})
