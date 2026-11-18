/**
 * Cost and speed on the record (D-63): `setupMetrics` and `priceTable` in results and the
 * certified export, from recorded attempts and an injected fixture price table. No
 * provider is called for any of it, and nothing reaches anyone before unsealing.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { PriceTable } from '../../src/domain/prices'
import { anthropicOk, createHarness, openAiOk, OWNER, setupOwner, startRun, type Harness } from './harness'

const FIXTURE: PriceTable = {
  version: 'fixture.1',
  readOn: '2026-11-18',
  effectiveFrom: '2026-11-01',
  sources: { openai: 'https://example.test/openai-prices', anthropic: 'https://example.test/anthropic-prices' },
  cachedInputIncludedInInput: { openai: true, anthropic: false },
  prices: {
    'openai-gpt-6-luna': { inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 10 },
    'anthropic-claude-haiku-5-5': { inputUsdPerMTok: 1, cachedInputUsdPerMTok: 0.1, outputUsdPerMTok: 5 },
  },
  unpriced: {},
}

let h: Harness
afterEach(async () => {
  await h.dispose()
})

async function runView(runId: string) {
  return (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
}

/** Score every response, then file and unseal (no jury). */
async function unseal(runId: string) {
  let view = await runView(runId)
  if (view.status === 'ready') {
    expect((await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })).status).toBe(200)
    view = await runView(runId)
  }
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
  const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: OWNER, ifMatch: review.sessionRevision, body: { ratings } })
  expect(saved.status).toBe(200)
  expect((await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
}

describe('setup metrics on the record', () => {
  it('prices every succeeded call with the injected table and puts the same numbers in the export', async () => {
    h = await createHarness({ priceTables: [FIXTURE] })
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId as string
    await h.drainJobs()
    expect((await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).status).toBe(409)
    await unseal(runId)

    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.priceTable).toEqual({ version: 'fixture.1', readOn: '2026-11-18', sources: FIXTURE.sources, predates: false })
    const [openai, anthropic] = results.configurations.map((c: any) => results.setupMetrics[c.key])
    // OpenAI stub: 120 in, 24 out → 120 × 2 + 24 × 10 = 480 µUSD per answer, 5 answers.
    expect(openai.cost).toEqual({ status: 'estimated', perAnswerMedianMicroUsd: 480, perThousandMicroUsd: 480_000, hearingMicroUsd: 2400, possiblyBilledUnknown: 0, cachedAssumedFull: 5 })
    // Anthropic stub: 130 in, 20 out → 130 + 100 = 230 µUSD.
    expect(anthropic.cost).toMatchObject({ status: 'estimated', perAnswerMedianMicroUsd: 230, hearingMicroUsd: 1150 })
    expect(openai.calls).toMatchObject({ planned: 5, succeeded: 5, failed: 0, retries: 0, providerCalls: 5, errorCodes: {} })
    expect(openai.tokens).toMatchObject({ medianInput: 120, medianOutput: 24, totalInput: 600, totalOutput: 120 })
    expect(openai.latency.n).toBe(5)
    expect(openai.consistency).toBeNull() // no repeats
    expect(openai.latency.slowestMs).toBeGreaterThanOrEqual(openai.latency.medianMs)
    // The coverage table keeps its fields (median latency included) for API compatibility.
    expect(results.coverage[results.configurations[0].key].medianLatencyMs).not.toBeUndefined()

    const exported = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    expect(exported.versions.priceTableVersion).toBe('fixture.1')
    expect(exported.setupMetrics).toEqual({ priceTable: results.priceTable, byConfiguration: results.setupMetrics })
    const again = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    expect(again.certification.contentSha256).toBe(exported.certification.contentSha256)
  })

  it('counts failures, retries and possibly billed calls, and measures medians on eligible questions only', async () => {
    h = await createHarness({ priceTables: [FIXTURE] })
    const setup = await setupOwner(h)
    let openaiCalls = 0
    h.setProvider(async (call) => {
      if (!call.url.includes('openai')) return anthropicOk()
      openaiCalls++
      if (openaiCalls === 1) return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 })
      if (openaiCalls === 2) throw new TypeError('network down')
      return openAiOk()
    })
    const runId = (await startRun(h, setup)).json.data.runId as string
    await h.drainJobs()
    const view = await runView(runId)
    const failed = view.generations.find((g: any) => g.status === 'failed')
    expect(failed.errorCode).toBe('PROVIDER_RATE_LIMITED')
    // Retry the definite failure (attempt 2 of 2); leave the uncertain one excluded.
    expect((await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: [failed.id], acknowledgePossiblePriorCharge: true } })).status).toBe(202)
    await h.drainJobs()
    await unseal(runId)

    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.eligibleCaseKeys).toHaveLength(4)
    const openaiKey = results.configurations.find((c: any) => c.provider === 'openai').key
    const anthropicKey = results.configurations.find((c: any) => c.provider === 'anthropic').key
    const openai = results.setupMetrics[openaiKey]
    expect(openai.calls).toMatchObject({ planned: 5, succeeded: 4, failed: 0, uncertain: 1, retries: 1, providerCalls: 6, errorCodes: { PROVIDER_RATE_LIMITED: 1, PROVIDER_NETWORK_ERROR: 1 } })
    expect(openai.cost).toMatchObject({ status: 'partial', possiblyBilledUnknown: 1, hearingMicroUsd: 4 * 480, perAnswerMedianMicroUsd: 480 })
    expect(openai.latency.n).toBe(4)
    // Anthropic answered all five; the excluded question still counts in its total, not its medians.
    const anthropic = results.setupMetrics[anthropicKey]
    expect(anthropic.latency.n).toBe(4)
    expect(anthropic.cost.hearingMicroUsd).toBe(5 * 230)
    expect(anthropic.calls.planned).toBe(5)
  })

  it('stores cached and reasoning usage and prices cached input at the cached rate (D-64)', async () => {
    h = await createHarness({ priceTables: [FIXTURE] })
    const setup = await setupOwner(h)
    h.setProvider(async (call) => {
      if (call.url.includes('openai')) {
        return new Response(
          JSON.stringify({ status: 'completed', model: 'gpt-6-luna', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Within 30 days with a receipt.' }] }], usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 400 }, output_tokens_details: { reasoning_tokens: 30 } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Yes, within 30 days.' }], stop_reason: 'end_turn', usage: { input_tokens: 600, output_tokens: 80, cache_read_input_tokens: 400, output_tokens_details: { thinking_tokens: 20 } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const runId = (await startRun(h, setup)).json.data.runId as string
    await h.drainJobs()
    const stored = (
      await h.db
        .prepare('SELECT g.provider, a.input_tokens, a.output_tokens, a.cached_input_tokens, a.reasoning_tokens FROM generation_attempts a JOIN generations g ON g.id = a.generation_id WHERE g.run_id = ?')
        .bind(runId)
        .all<{ provider: string; input_tokens: number; output_tokens: number; cached_input_tokens: number; reasoning_tokens: number }>()
    ).results
    expect(stored.find((row) => row.provider === 'openai')).toEqual({ provider: 'openai', input_tokens: 1000, output_tokens: 100, cached_input_tokens: 400, reasoning_tokens: 30 })
    expect(stored.find((row) => row.provider === 'anthropic')).toEqual({ provider: 'anthropic', input_tokens: 600, output_tokens: 80, cached_input_tokens: 400, reasoning_tokens: 20 })
    await unseal(runId)

    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    const key = (provider: string) => results.configurations.find((c: any) => c.provider === provider).key
    // OpenAI: (1000 − 400) × 2 + 400 × 0.5 + 100 × 10 = 2400 µUSD; cached input is known, so not an upper bound.
    expect(results.setupMetrics[key('openai')].cost).toMatchObject({ perAnswerMedianMicroUsd: 2400, cachedAssumedFull: 0 })
    expect(results.setupMetrics[key('openai')].tokens).toMatchObject({ totalCachedInput: 2000, totalReasoning: 150 })
    // Anthropic: 600 × 1 + 400 × 0.1 + 80 × 5 = 1040 µUSD.
    expect(results.setupMetrics[key('anthropic')].cost.perAnswerMedianMicroUsd).toBe(1040)
    expect(results.cases[0].responses.find((r: any) => r.configurationKey === key('openai'))).toMatchObject({ cachedInputTokens: 400, reasoningTokens: 30 })
  })

  it('labels hearings that predate the first price table', async () => {
    h = await createHarness({ priceTables: [{ ...FIXTURE, effectiveFrom: '2026-12-01' }] })
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId as string
    await h.drainJobs()
    await unseal(runId)
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.priceTable.predates).toBe(true)
    expect(Object.values(results.setupMetrics).every((m: any) => m.cost.status === 'estimated')).toBe(true)
  })

  it('reports no price rather than $0 for a route missing from the table', async () => {
    h = await createHarness({ priceTables: [{ ...FIXTURE, prices: { 'openai-gpt-6-luna': FIXTURE.prices['openai-gpt-6-luna'] } }] })
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId as string
    await h.drainJobs()
    await unseal(runId)
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    const anthropicKey = results.configurations.find((c: any) => c.provider === 'anthropic').key
    expect(results.setupMetrics[anthropicKey].cost).toMatchObject({ status: 'no_price', perAnswerMedianMicroUsd: null, hearingMicroUsd: null })
    expect(results.setupMetrics[anthropicKey].tokens.medianInput).toBe(130)
  })
})
