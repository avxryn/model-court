import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import SamplePage from '@/pages/(site)/sample'
import type { PartyMetrics } from '@/domain/setup-metrics'
import { SetupSection } from './SetupSection'
import { setupSentence, type SetupRow } from './setup-summary'

type View = Parameters<typeof SetupSection>[0]['data']

const generated = (over: { perAnswer?: number | null; hearing?: number | null; status?: PartyMetrics['cost']['status']; median?: number | null; slowest?: number | null; unknown?: number; codes?: Record<string, number>; retries?: number; uncertain?: number; reasoning?: number | null; consistency?: PartyMetrics['consistency'] } = {}): PartyMetrics => ({
  source: 'generated',
  calls: { planned: 2, succeeded: 2, failed: 0, uncertain: over.uncertain ?? 0, canceled: 0, retries: over.retries ?? 0, errorCodes: over.codes ?? {}, providerCalls: 2, medianPerAnswer: 1 },
  latency: { medianMs: over.median === undefined ? 1800 : over.median, slowestMs: over.slowest === undefined ? 3200 : over.slowest, n: 2 },
  tokens: { medianInput: 400, medianOutput: 120, totalInput: 800, totalOutput: 240, totalCachedInput: null, totalReasoning: over.reasoning ?? null, unknownUsage: 0 },
  cost: { status: over.status ?? 'estimated', perAnswerMedianMicroUsd: over.perAnswer === undefined ? 3100 : over.perAnswer, perThousandMicroUsd: over.perAnswer === null ? null : 3_100_000, hearingMicroUsd: over.hearing === undefined ? 6200 : over.hearing, possiblyBilledUnknown: over.unknown ?? 0, cachedAssumedFull: 0 },
  consistency: over.consistency ?? null,
})
const imported: PartyMetrics = {
  source: 'imported',
  calls: { planned: 2, succeeded: 2, failed: 0, uncertain: 0, canceled: 0, retries: 0, errorCodes: {}, providerCalls: 0, medianPerAnswer: null },
  latency: { medianMs: null, slowestMs: null, n: 0 },
  tokens: { medianInput: null, medianOutput: null, totalInput: 0, totalOutput: 0, totalCachedInput: null, totalReasoning: null, unknownUsage: 0 },
  cost: { status: 'imported', perAnswerMedianMicroUsd: null, perThousandMicroUsd: null, hearingMicroUsd: null, possiblyBilledUnknown: 0, cachedAssumedFull: 0 },
  consistency: null,
}

const judgment = (configurationKey: string, s: 0 | 1 | 2) => ({ reviewer: 'Juror 1', contextType: 'invited', configurationKey, correctness: s, completeness: s, grounding: s, note: '', suspectedIdentityClue: false })

function view(metrics: Record<string, PartyMetrics>, scores: (q: number) => [0 | 1 | 2, 0 | 1 | 2], predates = false, samplesPerAnswer = 1): View {
  return {
    samplesPerAnswer,
    configurations: [
      { key: 'cfg-a', label: 'Party A', provider: 'openai', modelId: 'gpt-6-luna' },
      { key: 'cfg-b', label: 'Party B', provider: metrics['cfg-b'].source === 'imported' ? null : 'openai', modelId: metrics['cfg-b'].source === 'imported' ? null : 'gpt-6.2-astra', provenance: metrics['cfg-b'].source === 'imported' ? { sourceType: 'human_baseline', description: 'x' } : undefined },
    ],
    cases: [1, 2, 3, 4, 5].map((q) => ({
      key: `case-${q}`,
      title: `Q${q}`,
      eligible: true,
      judgments: [judgment('cfg-a', scores(q)[0]), judgment('cfg-b', scores(q)[1])],
      responses: ['cfg-a', 'cfg-b'].map((configurationKey) => ({
        configurationKey,
        ...(samplesPerAnswer > 1
          ? {
              samples: Array.from({ length: samplesPerAnswer }, (_, i) => ({
                sampleNo: i + 1,
                primary: i === 0,
                status: i === samplesPerAnswer - 1 && q === 2 ? 'failed' : 'succeeded',
                errorCode: i === samplesPerAnswer - 1 && q === 2 ? 'PROVIDER_RATE_LIMITED' : null,
                attemptCount: 1,
                text: i === samplesPerAnswer - 1 && q === 2 ? null : `Answer ${configurationKey} q${q} s${i + 1}`,
                truncated: false,
                inputTokens: 400,
                outputTokens: 120,
                cachedInputTokens: null,
                reasoningTokens: null,
                durationMs: 1500,
              })),
            }
          : {}),
      })),
    })),
    eligibleCaseKeys: ['case-1', 'case-2', 'case-3', 'case-4', 'case-5'],
    setupMetrics: metrics,
    priceTable: { version: '2026-11-18.1', readOn: '2026-11-18', sources: { openai: 'https://developers.openai.com/api/docs/pricing', anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing' }, predates },
  } as unknown as View
}

describe('SetupSection', () => {
  it('shows estimates with their label, the footnote and both layouts', () => {
    const html = renderToStaticMarkup(<SetupSection data={view({ 'cfg-a': generated({ perAnswer: 1000, median: 1400 }), 'cfg-b': generated({ unknown: 1, codes: { PROVIDER_RATE_LIMITED: 1, PROVIDER_TIMEOUT: 1 }, retries: 1, uncertain: 1, reasoning: 60 }) }, () => [2, 2])} />)
    expect(html).toContain('id="setup"')
    expect(html).toContain('estimates, not charges')
    expect(html).toContain('Estimated at list prices from price table 2026-11-18.1')
    expect(html).toContain('Your provider bill is the authority')
    expect(html).toContain('$0.0031')
    expect(html).toContain('$0.0062 + 1 call of unknown cost')
    expect(html).toContain('1.8 s / 3.2 s')
    expect(html).toContain('400 in / 120 out')
    expect(html).toContain('out includes reasoning (25%)')
    expect(html).toContain('2 failed calls (rate limited, timed out), 1 retried, 1 uncertain')
    expect(html).toContain('at this hearing’s mix')
    expect(html).not.toContain('prices were read after')
    // Table for wide screens, cards for narrow ones.
    expect(html).toMatch(/hidden exhibit-panel overflow-hidden lg:block/)
    expect(html).toMatch(/<ul class="space-y-3 lg:hidden"/)
  })

  it('says “no price on file” and “unknown”, never $0, and labels older hearings', () => {
    const html = renderToStaticMarkup(<SetupSection data={view({ 'cfg-a': generated({ status: 'no_price', perAnswer: null, hearing: null }), 'cfg-b': generated({ status: 'partial', perAnswer: null }) }, () => [2, 2], true)} />)
    expect(html).toContain('No price on file for this model')
    expect(html).toContain('Unknown')
    expect(html).not.toMatch(/>\$0</)
    expect(html).toContain('prices were read after this hearing took place')
  })

  it('reads “Imported, not generated” across an imported party’s row', () => {
    const html = renderToStaticMarkup(<SetupSection data={view({ 'cfg-a': generated(), 'cfg-b': imported }, () => [2, 1])} />)
    expect(html).toContain('Imported, not generated: no cost or timing')
    expect(html).toMatch(/colSpan="6"|colspan="6"/)
  })

  it('ties the sentence to the headline: a leader is compared with the runner-up', () => {
    const data = view({ 'cfg-a': generated({ perAnswer: 1000, median: 1400 }), 'cfg-b': generated({ perAnswer: 3100, median: 2800 }) }, (q) => (q <= 4 ? [0, 2] : [2, 0]))
    expect(renderToStaticMarkup(<SetupSection data={data} />)).toContain('Party B scored higher on 4 of 5 questions; its answers cost about 3.1× as much as Party A’s and took 1.4 s longer at the median.')
  })

  it('states only cost and speed when the count is close or tied', () => {
    const close = view({ 'cfg-a': generated({ perAnswer: 1000, median: 1400 }), 'cfg-b': generated({ perAnswer: 3100, median: 2800 }) }, (q) => (q <= 3 ? [0, 2] : [2, 0]))
    const closeHtml = renderToStaticMarkup(<SetupSection data={close} />)
    expect(closeHtml).toContain('Party A’s answers cost about 32% of Party B’s and took 1.4 s less at the median.')
    expect(closeHtml).not.toContain('scored higher')
    const tie = view({ 'cfg-a': generated({ perAnswer: 3000, median: 2000 }), 'cfg-b': generated({ perAnswer: 3050, median: 2050 }) }, () => [1, 1])
    expect(renderToStaticMarkup(<SetupSection data={tie} />)).toContain('Party A’s answers cost about the same as Party B’s and took about as long at the median.')
  })

  it('handles three parties and all-imported hearings', () => {
    const row = (key: string, perAnswer: number, median: number): SetupRow => ({ key, label: key, source: '', reasoning: false, metrics: generated({ perAnswer, median }) })
    const tally = { outcome: 'close' as const, leader: null, parties: [], questions: [] }
    expect(setupSentence(tally, [row('A', 3000, 900), row('B', 1000, 2000), row('C', 2000, 1500)])).toBe('Lowest estimated cost per answer: B ($0.001). Fastest at the median: A (900 ms).')
    expect(setupSentence(tally, [{ key: 'I', label: 'I', source: '', reasoning: false, metrics: imported }])).toBe('Every party was imported, so there is no cost or timing to compare.')
  })
})

describe('SetupSection with repeats (D-66)', () => {
  const consistency = { compared: 5, sameAnswer: 3, medianOverlap: 0.82, answeredEveryTime: 4, planned: 5, medianLengthSpread: 0.1, latencySpread: 1.4, questions: [] }
  it('adds the Consistency column and the “Read every sample” fold only with repeats', () => {
    const once = renderToStaticMarkup(<SetupSection data={view({ 'cfg-a': generated(), 'cfg-b': generated() }, () => [2, 2])} />)
    expect(once).not.toContain('Consistency')
    expect(once).not.toContain('Read every sample')
    const twice = renderToStaticMarkup(<SetupSection data={view({ 'cfg-a': generated({ consistency }), 'cfg-b': generated({ consistency }) }, () => [2, 2], false, 2)} />)
    expect(twice).toContain('>Consistency<')
    expect(twice).toContain('Same answer 3 of 5 · wording overlap 82% · answered every time 4 of 5')
    expect(twice).toContain('Read every sample (2 per party per question)')
  })

  it('shows every sample with the jury’s marked, and failed samples with their reason', async () => {
    const { EverySampleForTest } = await import('./SetupSection')
    const html = renderToStaticMarkup(<EverySampleForTest data={view({ 'cfg-a': generated({ consistency }), 'cfg-b': generated({ consistency }) }, () => [2, 2], false, 3)} />)
    expect(html).toContain('Wording overlap compares letters, not meaning')
    expect(html).toContain('Answer cfg-a q1 s1')
    expect(html).toContain('Answer cfg-b q5 s3')
    expect(html.match(/scored by the jury/g)?.length).toBe(10)
    expect(html).toContain('The provider rate-limited the request.')
  })
})

describe('sample page', () => {
  it('ships the illustrative cost table (shown after unsealing)', () => {
    // The sealed sample renders first; the table component and fixture must at least import cleanly.
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SamplePage />
      </MemoryRouter>,
    )
    expect(html).toContain('Unseal the record')
  })
})
