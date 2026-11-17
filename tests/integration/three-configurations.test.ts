/**
 * T24 (F24): a third configuration on an existing provider gets the same
 * anonymization, counts, common-case scoring, budget caps, retry, and cancel
 * behavior as two.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anthropicOk, createHarness, openAiOk, OWNER, REVIEWER, setupOwner, type Harness, type HarnessOptions, type ProviderStub } from './harness'

let h: Harness
async function fresh(options?: HarnessOptions) {
  await h?.dispose()
  h = await createHarness(options)
}
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const THIRD_MARKER = 'THIRD-CONFIG-PROMPT'

/** Configuration mode: OpenAI and Anthropic, plus a second OpenAI configuration with different instructions. */
async function setupThree(user = OWNER) {
  const setup = await setupOwner(h, user)
  const { schemaVersion: _v, ...draft } = setup.draft
  draft.comparisonMode = 'configuration'
  const third = { ...draft.configurations[0], key: crypto.randomUUID(), label: 'Candidate 3', systemPrompt: `${draft.configurations[0].systemPrompt} ${THIRD_MARKER}` }
  draft.configurations.push(third)
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: user, ifMatch: 1, body: draft })
  expect(saved.status).toBe(200)
  return { ...setup, draft, revision: saved.json.data.revision as number, thirdKey: third.key as string }
}

async function start(setup: Awaited<ReturnType<typeof setupThree>>, user = OWNER) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: user,
    body: { draftRevision: setup.revision, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

const isThird = (body: Record<string, unknown>) => JSON.stringify(body).includes(THIRD_MARKER)
const stub =
  (thirdText = 'Third configuration answer'): ProviderStub =>
  async (call) =>
    call.url.includes('openai') ? openAiOk(isThird(call.body) ? thirdText : 'First configuration answer') : anthropicOk('Second configuration answer')

async function bucket(subject: string) {
  return (await h.db.prepare('SELECT allocated_units FROM budget_buckets WHERE subject = ?').bind(subject).first<{ allocated_units: number }>())?.allocated_units
}

async function runView(runId: string) {
  return (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
}

async function invite(runId: string): Promise<string> {
  const res = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  expect(res.status).toBe(201)
  return new URL(res.json.data.url).hash.replace('#token=', '')
}

async function openReview(runId: string) {
  const view = await runView(runId)
  const opened = await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })
  expect(opened.status).toBe(200)
  return opened.json.data
}

async function submit(runId: string, user: string, scoreFor: (label: string) => 0 | 1 | 2) {
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: user })).json.data
  const ratings = review.cases.flatMap((c: any) =>
    c.responses.map((r: any) => {
      const score = scoreFor(r.label)
      return { responseId: r.responseId, correctness: score, completeness: score, grounding: score, note: score === 0 ? 'Contradicts the reference policy.' : '', suspectedIdentityClue: false }
    }),
  )
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: user, ifMatch: review.sessionRevision, body: { ratings } })
  expect(saved.status).toBe(200)
  expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: user, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
  return review
}

describe('T24 admission and budget with three configurations', () => {
  it('plans cases × 3 calls, reserves one unit per call, and generates each configuration with its own instructions', async () => {
    const setup = await setupThree()
    h.setProvider(stub())
    const started = await start(setup)
    expect(started.status).toBe(202)
    expect(started.json.data.plannedCalls).toBe(15)
    expect(h.jobs).toHaveLength(15)
    expect(await bucket(`user:${OWNER}`)).toBe(15)
    expect(await bucket('global:day')).toBe(15)
    expect(await bucket('global:lifetime')).toBe(15)

    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(15)
    expect(h.providerCalls.filter((call) => isThird(call.body))).toHaveLength(5)
    // The two OpenAI configurations share the owner's one OpenAI key.
    expect(h.providerCalls.filter((call) => call.url.includes('openai')).every((call) => call.headers.authorization === 'Bearer sk-test-SENTINEL-OPENAI-KEY')).toBe(true)
    const view = await runView(started.json.data.runId)
    expect(view.status).toBe('ready')
    expect(view.configurations).toHaveLength(3)
    expect(view.counts).toMatchObject({ planned: 15, succeeded: 15 })
    expect(await bucket(`user:${OWNER}`)).toBe(15) // succeeded calls stay charged
  })

  it('refuses a run whose cases × 3 calls exceed the remaining daily cap, reserving nothing', async () => {
    await fresh({ env: { MAX_DAILY_CALLS_PER_USER: '14' } })
    const setup = await setupThree()
    const refused = await start(setup)
    expect(refused.status).toBe(429)
    expect(refused.json.error.code).toBe('QUOTA_EXHAUSTED')
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM runs').first<any>()).n).toBe(0)
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM attempt_reservations').first<any>()).n).toBe(0)
    expect(h.jobs).toHaveLength(0)

    await fresh({ env: { MAX_DAILY_CALLS_PER_USER: '15' } })
    expect((await start(await setupThree())).status).toBe(202) // exactly at the cap
  })

  it('an operator cap of two refuses a third configuration on save and at admission', async () => {
    const setup = await setupThree() // saved while the deployment allowed three
    h.env.MAX_CONFIGURATIONS_PER_RUN = '2'
    const catalog = await h.request('GET', '/catalog', { as: OWNER })
    expect(catalog.json.data.limits).toMatchObject({ configurations: 2, minConfigurations: 2 })
    const save = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: setup.revision, body: setup.draft })
    expect(save.status).toBe(422)
    expect(save.json.error.code).toBe('VALIDATION_FAILED')
    const refused = await start(setup)
    expect(refused.status).toBe(422)
    expect(h.jobs).toHaveLength(0)
    delete h.env.MAX_CONFIGURATIONS_PER_RUN
    expect((await h.request('GET', '/catalog', { as: OWNER })).json.data.limits.configurations).toBe(3)
  })

  it('model comparison with three configurations needs three distinct models', async () => {
    const setup = await setupOwner(h)
    const { schemaVersion: _v, ...draft } = setup.draft
    draft.configurations.push({ ...draft.configurations[0], key: crypto.randomUUID(), label: 'Candidate 3' })
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })).status).toBe(200)
    const refused = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
      as: OWNER,
      body: { draftRevision: 2, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(refused.status).toBe(422)
    expect(refused.json.error.code).toBe('UNSUPPORTED_CONFIGURATION')
  })
})

describe('T24 retry and cancel with three configurations', () => {
  it('retries a failed third-configuration call with one extra reservation and excludes a case that never completes', async () => {
    const setup = await setupThree()
    const failures = new Map<string, number>()
    h.setProvider(async (call) => {
      if (isThird(call.body)) {
        const input = JSON.stringify(call.body)
        const key = input.includes('45 days ago') ? 'window' : input.includes('different size') ? 'exchange' : null
        if (key === 'window' || (key === 'exchange' && !failures.has(key))) {
          failures.set(key, (failures.get(key) ?? 0) + 1)
          return new Response('{}', { status: 500 })
        }
      }
      return stub()(call, new AbortController().signal)
    })
    const runId = (await start(setup)).json.data.runId as string
    await h.drainJobs()
    let view = await runView(runId)
    const failed = view.generations.filter((g: any) => g.status === 'failed')
    expect(failed).toHaveLength(2)
    expect(failed.every((g: any) => g.configurationKey === setup.thirdKey && g.retryable)).toBe(true)

    const retry = await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: failed.map((g: any) => g.id), acknowledgePossiblePriorCharge: true } })
    expect(retry.status).toBe(202)
    expect(retry.json.data.retried).toBe(2)
    expect(await bucket(`user:${OWNER}`)).toBe(17)
    await h.drainJobs()
    view = await runView(runId)
    expect(view.counts).toMatchObject({ succeeded: 14, failed: 1 })
    expect(view.generations.find((g: any) => g.status === 'failed').retryable).toBe(false) // attempts exhausted
    expect(view.eligibility.caseKeys).toHaveLength(4)
    expect(view.eligibility.excludedCaseKeys).toHaveLength(1)

    const opened = await openReview(runId)
    expect(opened).toMatchObject({ eligibleCaseCount: 4, excludedCaseCount: 1 })
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    expect(review.cases).toHaveLength(4)
    expect(review.cases.every((c: any) => c.responses.length === 3)).toBe(true)
  })

  it('cancel releases every unsent reservation across all three configurations', async () => {
    const setup = await setupThree()
    const runId = (await start(setup)).json.data.runId as string
    // Send two calls, leave thirteen queued.
    const queued = h.jobs.splice(2)
    await h.drainJobs()
    expect(await bucket(`user:${OWNER}`)).toBe(15)
    const view = await runView(runId)
    const canceled = await h.request('POST', `/runs/${runId}/cancel`, { as: OWNER, ifMatch: view.revision, body: {} })
    expect(canceled.status).toBe(200)
    expect(await bucket(`user:${OWNER}`)).toBe(2)
    h.jobs.push(...queued)
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(2) // canceled work is never sent
    const after = await runView(runId)
    expect(after.status).toBe('canceled')
    expect(after.counts).toMatchObject({ succeeded: 2, canceled: 13 })
  })
})

describe('T24 anonymization and scoring with three configurations', () => {
  it('labels A/B/C, shuffles stably per session, hides identity, and scores common cases per configuration', async () => {
    const setup = await setupThree()
    h.setProvider(stub())
    const runId = (await start(setup)).json.data.runId as string
    await h.drainJobs()
    await openReview(runId)
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })

    const first = await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })
    const again = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    expect(again.cases).toEqual(first.json.data.cases)
    for (const c of first.json.data.cases) {
      expect(c.responses.map((r: any) => r.label)).toEqual(['A', 'B', 'C'])
      expect(new Set(c.responses.map((r: any) => r.text))).toEqual(new Set(['First configuration answer', 'Second configuration answer', 'Third configuration answer']))
    }

    const payloads = [first.text, (await h.request('GET', `/runs/${runId}`, { as: REVIEWER })).text, (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: REVIEWER })).text]
    const sentinels = ['gpt-6-luna', 'claude-haiku-5-5', 'openai', 'anthropic', 'Candidate 1', 'Candidate 2', 'Candidate 3', THIRD_MARKER, 'systemPrompt', 'snapshotHash', ...setup.draft.configurations.map((c: any) => c.key)]
    for (const payload of payloads) for (const sentinel of sentinels) expect(payload, `leaked ${sentinel}`).not.toContain(sentinel)

    // Score by text so each configuration gets a known score whatever the shuffle.
    const byText: Record<string, 0 | 1 | 2> = { 'First configuration answer': 1, 'Second configuration answer': 0, 'Third configuration answer': 2 }
    const textByLabel = (review: any) => new Map<string, string>(review.cases[0].responses.map((r: any) => [r.label, r.text]))
    const reviewerTexts = textByLabel(first.json.data)
    // Per-case shuffles differ by case, so rate each response by its own text.
    const submitByText = async (user: string) => {
      const review = (await h.request('GET', `/runs/${runId}/review`, { as: user })).json.data
      const ratings = review.cases.flatMap((c: any) =>
        c.responses.map((r: any) => {
          const score = byText[r.text]
          return { responseId: r.responseId, correctness: score, completeness: score, grounding: score, note: score === 0 ? 'Contradicts the reference policy.' : '', suspectedIdentityClue: false }
        }),
      )
      const saved = await h.request('PUT', `/runs/${runId}/review`, { as: user, ifMatch: review.sessionRevision, body: { ratings } })
      expect(saved.status).toBe(200)
      expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: user, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
    }
    expect(reviewerTexts.size).toBe(3)
    await submitByText(REVIEWER)
    await submit(runId, OWNER, () => 2)

    const view = await runView(runId)
    expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 0 } })).status).toBe(200)
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    const [k1, k2, k3] = setup.draft.configurations.map((c: any) => c.key)
    expect(results.configurations.map((c: any) => c.key)).toEqual([k1, k2, k3])
    const invited = results.cohorts.invited
    expect(invited.caseCount).toBe(5)
    expect(invited.byConfiguration[k1].overallMean).toBe(1)
    expect(invited.byConfiguration[k2].overallMean).toBe(0)
    expect(invited.byConfiguration[k3].overallMean).toBe(2)
    expect(invited.highest).toEqual([k3])
    expect(results.cohorts.owner.highest).toEqual([k1, k2, k3])
    expect(Object.keys(results.coverage)).toEqual([k1, k2, k3])
    expect(results.cases[0].responses).toHaveLength(3)

    const verdict = await h.request('POST', `/runs/${runId}/verdicts`, { as: OWNER, ifMatch: results.revision, body: { outcome: 'selected', selectedConfigurationKey: k3, rationale: 'The third configuration grounded every answer.', limitations: 'Five cases only.' } })
    expect(verdict.status).toBe(201)
  })

  it('stores one response per configuration per case, labeled A/B/C', async () => {
    const setup = await setupThree()
    const runId = (await start(setup)).json.data.runId as string
    await h.drainJobs()
    await openReview(runId)
    const rows = (await h.db.prepare('SELECT assignment_json FROM review_sessions WHERE run_id = ?').bind(runId).all<any>()).results
    expect(rows).toHaveLength(1)
    for (const item of JSON.parse(rows[0].assignment_json)) {
      expect(item.responses.map((r: any) => r.label)).toEqual(['A', 'B', 'C'])
      expect(new Set(item.responses.map((r: any) => r.configurationKey))).toEqual(new Set(setup.draft.configurations.map((c: any) => c.key)))
    }
  })
})
