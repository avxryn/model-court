import { describe, expect, it } from 'vitest'
import type { PriceTable } from './prices'
import { formatMicroUsd, median, setupMetrics, type AttemptUsage, type UsageRecord } from './setup-metrics'

const TABLE: PriceTable = {
  version: 'test.1',
  readOn: '2026-11-18',
  effectiveFrom: '2026-01-01',
  sources: { openai: 'https://example.test/openai', anthropic: 'https://example.test/anthropic' },
  cachedInputIncludedInInput: { openai: true, anthropic: false },
  prices: {
    'openai-a': { inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 10 },
    'anthropic-b': { inputUsdPerMTok: 1, cachedInputUsdPerMTok: 0.1, outputUsdPerMTok: 5 },
  },
  unpriced: { 'openai-free': 'no list price published' },
}

const ok = (input: number | null, output: number | null, durationMs: number | null, extra: Partial<AttemptUsage> = {}): AttemptUsage => ({
  attemptNo: 1,
  status: 'succeeded',
  errorCode: null,
  definite: null,
  inputTokens: input,
  outputTokens: output,
  cachedInputTokens: null,
  reasoningTokens: null,
  durationMs,
  ...extra,
})
const fail = (code: string, definite: boolean, extra: Partial<AttemptUsage> = {}): AttemptUsage => ({
  attemptNo: 1,
  status: definite ? 'failed' : 'uncertain',
  errorCode: code,
  definite,
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  durationMs: 40,
  ...extra,
})
const rec = (caseKey: string, configurationKey: string, status: UsageRecord['status'], attempts: AttemptUsage[], extra: Partial<UsageRecord> = {}): UsageRecord => ({ caseKey, configurationKey, sampleNo: 1, status, attempts, ...extra })

const PARTIES = [
  { key: 'A', source: 'generated' as const, provider: 'openai' as const, routeKey: 'openai-a' },
  { key: 'B', source: 'generated' as const, provider: 'anthropic' as const, routeKey: 'anthropic-b' },
]

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(3) // (2 + 3) / 2 rounded
    expect(median([])).toBeNull()
  })
})

describe('setupMetrics', () => {
  it('computes cost, latency and tokens per party from succeeded answers', () => {
    const metrics = setupMetrics(
      {
        parties: PARTIES,
        eligibleCaseKeys: ['q1', 'q2', 'q3'],
        records: [
          rec('q1', 'A', 'succeeded', [ok(1000, 100, 1200)]),
          rec('q2', 'A', 'succeeded', [ok(2000, 200, 1800)]),
          rec('q3', 'A', 'succeeded', [ok(3000, 300, 3200)]),
          rec('q1', 'B', 'succeeded', [ok(1000, 100, 900)]),
          rec('q2', 'B', 'succeeded', [ok(1000, 100, 1100)]),
          rec('q3', 'B', 'succeeded', [ok(1000, 100, 1000)]),
        ],
      },
      TABLE,
    )
    // A: 1000×2 + 100×10 = 3000 µUSD; 6000; 9000.
    expect(metrics.A.cost).toMatchObject({ status: 'estimated', perAnswerMedianMicroUsd: 6000, hearingMicroUsd: 18000, perThousandMicroUsd: 6_000_000, possiblyBilledUnknown: 0 })
    expect(metrics.A.latency).toEqual({ medianMs: 1800, slowestMs: 3200, n: 3 })
    expect(metrics.A.tokens).toMatchObject({ medianInput: 2000, medianOutput: 200, totalInput: 6000, totalOutput: 600, totalCachedInput: null, totalReasoning: null })
    // B: 1000×1 + 100×5 = 1500 µUSD each.
    expect(metrics.B.cost.perAnswerMedianMicroUsd).toBe(1500)
    expect(metrics.B.latency.medianMs).toBe(1000)
    expect(metrics.A.calls).toMatchObject({ planned: 3, succeeded: 3, retries: 0, providerCalls: 3, medianPerAnswer: 1 })
  })

  it('excludes failed durations, counts retries from attempt 2 and tallies error codes', () => {
    const metrics = setupMetrics(
      {
        parties: [PARTIES[0]],
        eligibleCaseKeys: ['q1', 'q2'],
        records: [
          rec('q1', 'A', 'succeeded', [fail('PROVIDER_RATE_LIMITED', true, { durationMs: 5 }), ok(1000, 100, 2000, { attemptNo: 2 })]),
          rec('q2', 'A', 'failed', [fail('PROVIDER_RATE_LIMITED', true), fail('PROVIDER_AUTH_FAILED', true, { attemptNo: 2 })]),
        ],
      },
      TABLE,
    )
    expect(metrics.A.latency).toEqual({ medianMs: 2000, slowestMs: 2000, n: 1 })
    expect(metrics.A.calls).toMatchObject({ planned: 2, succeeded: 1, failed: 1, retries: 2, providerCalls: 4 })
    expect(metrics.A.calls.errorCodes).toEqual({ PROVIDER_RATE_LIMITED: 2, PROVIDER_AUTH_FAILED: 1 })
    // Definite failures without usage cost nothing as far as we know.
    expect(metrics.A.cost).toMatchObject({ status: 'estimated', hearingMicroUsd: 3000, possiblyBilledUnknown: 0 })
  })

  it('uses eligible questions for medians but every call for totals', () => {
    const metrics = setupMetrics(
      {
        parties: [PARTIES[0]],
        eligibleCaseKeys: ['q1'],
        records: [rec('q1', 'A', 'succeeded', [ok(1000, 100, 1000)]), rec('q2', 'A', 'succeeded', [ok(5000, 500, 9000)])],
      },
      TABLE,
    )
    expect(metrics.A.cost.perAnswerMedianMicroUsd).toBe(3000)
    expect(metrics.A.cost.hearingMicroUsd).toBe(3000 + 15000)
    expect(metrics.A.latency.slowestMs).toBe(1000)
    expect(metrics.A.tokens.totalInput).toBe(6000)
  })

  it('counts uncertain calls and succeeded calls without usage as possibly billed, never as $0', () => {
    const metrics = setupMetrics(
      {
        parties: [PARTIES[0]],
        eligibleCaseKeys: ['q1', 'q2'],
        records: [rec('q1', 'A', 'succeeded', [ok(null, null, 1000)]), rec('q2', 'A', 'uncertain', [fail('PROVIDER_TIMEOUT', false)])],
      },
      TABLE,
    )
    expect(metrics.A.cost).toMatchObject({ status: 'partial', possiblyBilledUnknown: 2, hearingMicroUsd: 0, perAnswerMedianMicroUsd: null, perThousandMicroUsd: null })
    expect(metrics.A.tokens.unknownUsage).toBe(1)
    expect(metrics.A.calls.uncertain).toBe(1)
  })

  it('does not count canceled or provably unsent attempts as provider calls', () => {
    const metrics = setupMetrics(
      {
        parties: [PARTIES[0]],
        eligibleCaseKeys: [],
        records: [rec('q1', 'A', 'canceled', [fail('CANCELED', true)])],
      },
      TABLE,
    )
    expect(metrics.A.calls).toMatchObject({ canceled: 1, providerCalls: 0, errorCodes: {} })
  })

  it('reports no price for unpriced routes and imported parties separately', () => {
    const metrics = setupMetrics(
      {
        parties: [
          { key: 'A', source: 'generated', provider: 'openai', routeKey: 'openai-free' },
          { key: 'I', source: 'imported', provider: null, routeKey: null },
        ],
        eligibleCaseKeys: ['q1'],
        records: [rec('q1', 'A', 'succeeded', [ok(1000, 100, 1000)])],
      },
      TABLE,
      { I: { planned: 1, present: 1 } },
    )
    expect(metrics.A.cost).toMatchObject({ status: 'no_price', perAnswerMedianMicroUsd: null, hearingMicroUsd: null })
    expect(metrics.A.tokens.medianInput).toBe(1000)
    expect(metrics.I).toMatchObject({ source: 'imported', cost: { status: 'imported' }, calls: { planned: 1, succeeded: 1, providerCalls: 0 }, latency: { medianMs: null } })
  })

  it('prices cached input on both providers and records reasoning totals', () => {
    const metrics = setupMetrics(
      {
        parties: PARTIES,
        eligibleCaseKeys: ['q1'],
        records: [
          rec('q1', 'A', 'succeeded', [ok(1000, 100, 1000, { cachedInputTokens: 400, reasoningTokens: 60 })]),
          rec('q1', 'B', 'succeeded', [ok(1000, 100, 1000, { cachedInputTokens: 400 })]),
        ],
      },
      TABLE,
    )
    // OpenAI: (1000 − 400) × 2 + 400 × 0.5 + 100 × 10 = 1200 + 200 + 1000.
    expect(metrics.A.cost.perAnswerMedianMicroUsd).toBe(2400)
    expect(metrics.A.cost.cachedAssumedFull).toBe(0)
    expect(metrics.A.tokens).toMatchObject({ totalCachedInput: 400, totalReasoning: 60 })
    // Anthropic: 1000 × 1 + 400 × 0.1 + 100 × 5 = 1000 + 40 + 500.
    expect(metrics.B.cost.perAnswerMedianMicroUsd).toBe(1540)
    expect(metrics.B.tokens.totalReasoning).toBeNull()
  })

  it('aggregates tool-loop testimonies that took several calls', () => {
    const metrics = setupMetrics(
      { parties: [PARTIES[0]], eligibleCaseKeys: ['q1', 'q2'], records: [rec('q1', 'A', 'succeeded', [ok(3000, 300, 4000)], { calls: 3 }), rec('q2', 'A', 'succeeded', [ok(1000, 100, 1000)])] },
      TABLE,
    )
    expect(metrics.A.calls.providerCalls).toBe(4)
    expect(metrics.A.calls.medianPerAnswer).toBe(2)
  })

  it('is empty for a party with no records', () => {
    const metrics = setupMetrics({ parties: [PARTIES[0]], eligibleCaseKeys: [], records: [] }, TABLE)
    expect(metrics.A).toMatchObject({ calls: { planned: 0 }, latency: { medianMs: null, slowestMs: null, n: 0 }, cost: { status: 'estimated', perAnswerMedianMicroUsd: null, hearingMicroUsd: 0 } })
  })
})

describe('formatMicroUsd', () => {
  it('formats small and large estimates', () => {
    expect(formatMicroUsd(0)).toBe('$0')
    expect(formatMicroUsd(40)).toBe('under $0.0001')
    expect(formatMicroUsd(3100)).toBe('$0.0031')
    expect(formatMicroUsd(31_400)).toBe('$0.031')
    expect(formatMicroUsd(314_000)).toBe('$0.31')
    expect(formatMicroUsd(3_140_000)).toBe('$3.14')
    expect(formatMicroUsd(1_234_567_000)).toBe('$1,234.57')
  })
})
