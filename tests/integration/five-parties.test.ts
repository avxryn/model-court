/**
 * Spec 07 §9, §11.2 (D-110): up to five parties under the 15-testimony limit, on both stores, with a
 * fake `providerFetch` (no network, no paid call). 5 × 3 starts and 5 × 4 is refused at save and at
 * Start; three jurors see labels A–E in a balanced rotation, never a party; the record's tally, the
 * setup metrics and the export cover five parties; and five parties work with every kit, repeats,
 * the special master, budget reservations and the tool loop's worst-case step reservation.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { parseCsv } from '../../src/domain/csv'
import { EXTRACTION_STARTERS } from '../../src/domain/extraction/starters'
import { EXAMPLE_TOOL_TASK } from '../../src/domain/tools/task'
import { anthropicOk, createHarness, okStub, openAiOk, openDeliberation, OWNER, REVIEWER, setupOwner, type Harness, type HarnessOptions, type ProviderStub } from './harness'

let h: Harness
afterEach(async () => {
  await h?.dispose()
})

const FIVE: HarnessOptions = { env: { MAX_CONFIGURATIONS_PER_RUN: '5' } }
const JURORS = ['user_juror_a', 'user_juror_b', 'user_juror_c']
type Setup = Awaited<ReturnType<typeof setupOwner>>

/** Party n's marker in its system prompt, so the stub can answer per party. */
const marker = (n: number) => `PARTY-${n}-MARKER`
const partyOf = (body: unknown) => Number(/PARTY-(\d)-MARKER/.exec(JSON.stringify(body))?.[1] ?? 0)
const textFor = (n: number) => `Answer from party ${n}: returns within 30 days with a receipt.`
const partyStub: ProviderStub = async (call) => (call.url.includes('openai') ? openAiOk(textFor(partyOf(call.body))) : anthropicOk(textFor(partyOf(call.body))))

/** `parties` parties (alternating OpenAI and Anthropic, configuration mode) on `questions` questions. */
function fiveDraft(setup: Setup, parties: number, questions: number, extra: Record<string, unknown> = {}) {
  const { schemaVersion: _v, ...base } = setup.draft
  const [openai, anthropic] = base.configurations
  const configurations = Array.from({ length: parties }, (_, i) => ({ ...(i % 2 === 0 ? openai : anthropic), key: crypto.randomUUID(), label: `Setup ${i + 1}`, systemPrompt: `${openai.systemPrompt} ${marker(i + 1)}` }))
  const cases = Array.from({ length: questions }, (_, i) => ({ ...base.cases[i % base.cases.length], key: crypto.randomUUID(), title: `Question ${i + 1}` }))
  return { ...base, comparisonMode: 'configuration', configurations, cases, ...extra }
}

async function save(setup: Setup, draft: unknown, ifMatch = 1) {
  return h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch, body: draft })
}

async function start(setup: Setup, revision: number) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: revision, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

async function seat(runId: string, user: string) {
  const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  expect(invite.status).toBe(201)
  const redeemed = await h.request('POST', '/invites/redeem', { as: user, body: { token: new URL(invite.json.data.url).hash.replace('#token=', '') } })
  expect(redeemed.status, JSON.stringify(redeemed.json)).toBe(200)
}

/** Scores: the party whose answer names `best` gets 2s, the others 1s. */
async function score(runId: string, user: string, best: (text: string) => boolean, submit = true) {
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: user })).json.data
  const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: best(r.text) ? 2 : 1, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: user, ifMatch: review.sessionRevision, body: { ratings } })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  if (submit) expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: user, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
  return review
}

async function bucket(subject: string) {
  return Number((await h.db.prepare('SELECT allocated_units FROM budget_buckets WHERE subject = ?').bind(subject).first<{ allocated_units: number }>())?.allocated_units ?? 0)
}

describe('five parties: limits', () => {
  it('keeps the deployment default at three parties until the operator raises it', async () => {
    h = await createHarness()
    const setup = await setupOwner(h)
    const four = await save(setup, fiveDraft(setup, 4, 3))
    expect(four.status).toBe(422)
    expect(JSON.stringify(four.json)).toContain('at most 3 configurations')
    expect((await h.request('GET', '/catalog', { as: OWNER })).json.data.limits.configurations).toBe(3)
  })

  it('saves 4 × 3 and 5 × 3, refuses 5 × 4 and six parties at draft save with the plain message, and fails closed at Start', async () => {
    h = await createHarness(FIVE)
    const setup = await setupOwner(h)
    expect((await h.request('GET', '/catalog', { as: OWNER })).json.data.limits).toMatchObject({ configurations: 5, maxTestimoniesPerHearing: 15 })
    const refused = await save(setup, fiveDraft(setup, 5, 4))
    expect(refused.status).toBe(422)
    expect(JSON.stringify(refused.json)).toContain('5 parties × 4 questions is 20 answers for each juror to score. The limit is 15: remove a question or a party.')
    expect((await save(setup, fiveDraft(setup, 6, 2))).status).toBe(422)
    // 4 × 3 and 5 × 3 fit.
    expect((await save(setup, fiveDraft(setup, 4, 3))).status).toBe(200)
    expect((await save(setup, fiveDraft(setup, 5, 3), 2)).status).toBe(200)
    // A draft can never be stored over the limit, but one written by hand fails closed at Start: no hearing, nothing reserved.
    const over = fiveDraft(setup, 5, 4)
    await h.db.prepare('UPDATE evaluations SET draft_json = ?, revision = revision + 1 WHERE id = ?').bind(JSON.stringify({ ...over, schemaVersion: 1 }), setup.evaluationId).run()
    const atStart = await start(setup, 4)
    expect(atStart.status).toBeGreaterThanOrEqual(400)
    expect(h.providerCalls).toHaveLength(0)
    expect(await bucket(`user:${OWNER}`)).toBe(0)
    expect(Number((await h.db.prepare('SELECT COUNT(*) AS n FROM runs').first<{ n: number }>())?.n)).toBe(0)
  })

  it('counts imported parties toward the 15', async () => {
    h = await createHarness(FIVE)
    const setup = await setupOwner(h)
    const draft = fiveDraft(setup, 4, 3)
    const imported = { kind: 'imported', key: crypto.randomUUID(), label: 'Baseline', provenance: { sourceType: 'human_baseline', description: 'Support lead', redacted: false } }
    const res = await save(setup, { ...draft, configurations: [...draft.configurations, imported], cases: [...draft.cases, { ...draft.cases[0], key: crypto.randomUUID() }] })
    expect(res.status).toBe(422)
    expect(JSON.stringify(res.json)).toContain('5 parties × 4 questions')
  })
})

describe('five parties: a full hearing', () => {
  it('runs 5 × 3 with 15 calls and units; three jurors get A–E in a balanced rotation and never a party; the record and export cover five parties', async () => {
    h = await createHarness(FIVE)
    h.setProvider(partyStub)
    const setup = await setupOwner(h)
    const draft = fiveDraft(setup, 5, 3)
    expect((await save(setup, draft)).status).toBe(200)
    const started = await start(setup, 2)
    expect(started.status, JSON.stringify(started.json)).toBe(202)
    const runId = started.json.data.runId as string
    expect(await bucket(`user:${OWNER}`)).toBe(15)
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(15)
    await openDeliberation(h, runId)
    for (const juror of JURORS) await seat(runId, juror)

    // Labels A–E per question; the same party sits in a different position for each session.
    const positions = new Map<string, Map<number, Set<string>>>() // caseKey → party → labels seen
    for (const user of [OWNER, ...JURORS]) {
      const review = await h.request('GET', `/runs/${runId}/review`, { as: user })
      for (const word of ['Setup 1', 'Setup 5', 'openai', 'anthropic', 'PARTY-', 'configurationKey', 'modelKey', 'inputTokens']) expect(review.text, `${user} ${word}`).not.toContain(word)
      for (const c of review.json.data.cases) {
        expect(c.responses.map((r: any) => r.label)).toEqual(['A', 'B', 'C', 'D', 'E'])
        for (const r of c.responses) {
          const party = Number(/party (\d)/.exec(r.text)![1])
          const byParty = positions.get(c.caseKey) ?? new Map()
          byParty.set(party, (byParty.get(party) ?? new Set()).add(r.label))
          positions.set(c.caseKey, byParty)
        }
      }
    }
    // Four sessions over five positions: with the rotation each party sees four different labels.
    for (const byParty of positions.values()) for (const labels of byParty.values()) expect(labels.size).toBe(4)

    // Party 3 is best for every juror; the owner does not file (the jury is the source).
    for (const juror of JURORS) await score(runId, juror, (text) => text.includes('party 3'))
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } })).status).toBe(200)
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.configurations).toHaveLength(5)
    expect(results.cases.every((c: any) => c.responses.length === 5)).toBe(true)
    const third = draft.configurations[2].key
    const jury = results.cohorts.invited
    expect(jury.highest).toEqual([third])
    expect(Object.keys(results.setupMetrics)).toHaveLength(5)

    // The CSV export has every party on its rows.
    const csv = await h.request('GET', `/runs/${runId}/export?format=csv`, { as: OWNER })
    expect(csv.status).toBe(200)
    const parsed = parseCsv(csv.text)
    expect(parsed.ok).toBe(true)
    const rows = parsed.ok ? parsed.rows : []
    const labels = new Set(rows.slice(1).flatMap((row) => row).filter((cell) => /^Setup \d$/.test(cell)))
    expect([...labels].sort()).toEqual(['Setup 1', 'Setup 2', 'Setup 3', 'Setup 4', 'Setup 5'])
    void REVIEWER
  })
})

describe('five parties with every kit', () => {
  const run = async (draftFor: (setup: Setup) => Record<string, unknown>, stub: ProviderStub, after?: (setup: Setup, revision: number) => Promise<number>) => {
    h = await createHarness(FIVE)
    h.setProvider(stub)
    const setup = await setupOwner(h)
    const saved = await save(setup, draftFor(setup))
    expect(saved.status, JSON.stringify(saved.json)).toBe(200)
    const revision = after ? await after(setup, 2) : 2
    const started = await start(setup, revision)
    expect(started.status, JSON.stringify(started.json)).toBe(202)
    const runId = started.json.data.runId as string
    await h.drainJobs()
    await openDeliberation(h, runId)
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    expect(review.cases[0].responses.map((r: any) => r.label)).toEqual(['A', 'B', 'C', 'D', 'E'])
    return { runId, review }
  }

  it('summarization: five answers, checks on each', async () => {
    const settings = { lengthUnit: 'words', maxLength: 12, format: 'bullets', checkNumbers: true }
    const fields = { kind: 'summarization', requiredPoints: [{ text: 'Return window', anyOf: ['30 days'] }], mustNotMention: ['Whitfield'] }
    const { runId } = await run((setup) => { const d = fiveDraft(setup, 5, 1); return { ...d, kit: { version: 'summarization-v1', settings }, cases: d.cases.map((c: any) => ({ ...c, kitFields: fields })) } }, async (call) => (call.url.includes('openai') ? openAiOk('- Returns within 30 days.') : anthropicOk('- Returns within 30 days.')))
    expect(Number((await h.db.prepare('SELECT COUNT(*) AS n FROM testimony_checks WHERE run_id = ?').bind(runId).first<{ n: number }>())?.n)).toBe(5)
  })

  it('classification: five answers, checks on each', async () => {
    const settings = { labels: ['Billing', 'Bug', 'Other'], minReasoningWords: 3 }
    const { runId } = await run((setup) => { const d = fiveDraft(setup, 5, 1); return { ...d, kit: { version: 'classification-v1', settings }, cases: d.cases.map((c: any) => ({ ...c, kitFields: { kind: 'classification', expectedLabel: 'Billing' } })) } }, async (call) => (call.url.includes('openai') ? openAiOk('Label: Billing\nIt is about a charge on the card.') : anthropicOk('Label: Bug\nThe app fails to load the page.')))
    expect(Number((await h.db.prepare('SELECT COUNT(*) AS n FROM testimony_checks WHERE run_id = ?').bind(runId).first<{ n: number }>())?.n)).toBe(5)
  })

  it('extraction (text): five answers rendered as fields', async () => {
    const schema = EXTRACTION_STARTERS[1].schema
    const json = '{"city":"Portland","fullName":"Dana Whitfield","organization":"Fabrikam Studio","email":"dana@fabrikam.example","phone":"(503) 555-0142"}'
    const { review } = await run(
      (setup) => { const d = fiveDraft(setup, 5, 1); return { ...d, kit: { version: 'extraction-v1', settings: { schema, compare: {} } }, cases: [{ key: d.cases[0].key, title: 'Intake email', input: 'Extract the fields from the document.', reference: '', expectedBehavior: 'Check each value.', kitFields: { kind: 'extraction' } }] } },
      async (call) => (call.url.includes('openai') ? openAiOk(json) : anthropicOk(json)),
      async (setup, revision) => {
        const caseKey = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data.draft.cases[0].key
        const up = await h.request('PUT', `/evaluations/${setup.evaluationId}/documents/${caseKey}`, { as: OWNER, ifMatch: revision, body: { kind: 'text', text: 'From: Dana Whitfield <dana@fabrikam.example>\nFabrikam Studio, Portland\nPhone: (503) 555-0142\n' } })
        expect(up.status, JSON.stringify(up.json)).toBe(200)
        return revision + 1
      },
    )
    expect(review.cases[0].responses.every((r: any) => r.extraction)).toBe(true)
  })

  it('grounded sources: five answers with citations', async () => {
    const { review } = await run(
      (setup) => { const d = fiveDraft(setup, 5, 1); return { ...d, kit: { version: 'grounded-v1', settings: {} }, cases: [{ key: d.cases[0].key, title: 'Refunds', input: 'How long do I have to ask for a refund?', reference: '', expectedBehavior: 'Check each claim.', kitFields: { kind: 'grounded', answerable: 'yes', requiredSources: [1] } }] } },
      async (call) => (call.url.includes('openai') ? openAiOk('Within 30 days [S1].') : anthropicOk('Within 30 days [S1].')),
      async (setup, revision) => {
        const caseKey = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data.draft.cases[0].key
        const put = await h.request('PUT', `/evaluations/${setup.evaluationId}/sources/${caseKey}`, { as: OWNER, ifMatch: revision, body: { sources: [{ number: 1, title: 'Refund policy', text: 'Customers can request a refund within 30 days of purchase.' }] } })
        expect(put.status, JSON.stringify(put.json)).toBe(200)
        return put.json.data.revision as number
      },
    )
    expect(review.cases[0].sources).toBeDefined()
  })

  it('tools: five parties reserve the worst case (parties × step cap) up front and give unused steps back', async () => {
    h = await createHarness(FIVE)
    const setup = await setupOwner(h)
    const d = fiveDraft(setup, 5, 1)
    const kitFields = { kind: 'tools', ...EXAMPLE_TOOL_TASK, maxSteps: 4, expect: { ...EXAMPLE_TOOL_TASK.expect, targetSteps: undefined } }
    expect((await save(setup, { ...d, kit: { version: 'tools-v1', settings: {} }, cases: d.cases.map((c: any) => ({ ...c, kitFields })) })).status).toBe(200)
    // Every party answers on its first step, so three of its four reserved steps go back.
    h.setProvider(async (call) => (call.url.includes('openai') ? openAiOk('Your order is late; I refunded the shipping.') : anthropicOk('Your order is late; I refunded the shipping.')))
    const started = await start(setup, 2)
    expect(started.status, JSON.stringify(started.json)).toBe(202)
    expect(await bucket(`user:${OWNER}`)).toBe(20)
    await h.drainJobs()
    expect(await bucket(`user:${OWNER}`)).toBe(5)
    const review = (await h.request('GET', `/runs/${started.json.data.runId}/review`, { as: OWNER })).json.data
    expect(review.cases[0].responses.map((r: any) => r.label)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(review.cases[0].responses.every((r: any) => r.trace)).toBe(true)
  })

  it('a tool hearing whose worst case passes the daily cap is refused with nothing reserved', async () => {
    h = await createHarness(FIVE)
    const setup = await setupOwner(h)
    const d = fiveDraft(setup, 5, 1)
    const kitFields = { kind: 'tools', ...EXAMPLE_TOOL_TASK, maxSteps: 5, expect: { ...EXAMPLE_TOOL_TASK.expect, targetSteps: undefined } }
    expect((await save(setup, { ...d, kit: { version: 'tools-v1', settings: {} }, cases: d.cases.map((c: any) => ({ ...c, kitFields })) })).status).toBe(200)
    const refused = await start(setup, 2)
    expect(refused.status).toBe(429)
    expect(await bucket(`user:${OWNER}`)).toBe(0)
  })
})

describe('five parties with repeats and the special master', () => {
  it('repeats: 5 parties × 1 question × 3 samples reserves 15 units, jurors still score 5', async () => {
    h = await createHarness(FIVE)
    h.setProvider(partyStub)
    const setup = await setupOwner(h)
    expect((await save(setup, fiveDraft(setup, 5, 1, { samplesPerAnswer: 3 }))).status).toBe(200)
    const started = await start(setup, 2)
    expect(started.status, JSON.stringify(started.json)).toBe(202)
    expect(await bucket(`user:${OWNER}`)).toBe(15)
    expect(Number((await h.db.prepare('SELECT COUNT(*) AS n FROM generations WHERE run_id = ?').bind(started.json.data.runId).first<{ n: number }>())?.n)).toBe(15)
  })

  it('the special master grades all 15 testimonies of a 5 × 3 hearing', async () => {
    h = await createHarness(FIVE)
    const grade = '{"correctness":2,"completeness":1,"grounding":2,"note":"Omits the receipt rule."}'
    h.setProvider(async (call, signal) => (JSON.stringify(call.body).includes('responseToGrade') ? (call.url.includes('openai') ? openAiOk(grade) : anthropicOk(grade)) : partyStub(call, signal)))
    const setup = await setupOwner(h)
    expect((await save(setup, fiveDraft(setup, 5, 3))).status).toBe(200)
    const runId = (await start(setup, 2)).json.data.runId as string
    await h.drainJobs()
    await openDeliberation(h, runId)
    const review = await score(runId, OWNER, () => true, false)
    const saved = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    expect((await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: saved.sessionRevision, body: {} })).status).toBe(200)
    void review
    // The next day, so the 15 grading calls fit the daily cap.
    h.advance(24 * 60 * 60 * 1000)
    const startedGrader = await h.request('POST', `/runs/${runId}/special-master`, { as: OWNER, body: { modelKey: 'anthropic-claude-haiku-5-5', credentialIdsByProvider: { anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true } })
    expect(startedGrader.status, JSON.stringify(startedGrader.json)).toBe(202)
    await h.drainJobs()
    const items = await h.db.prepare(`SELECT status FROM grader_items`).all<{ status: string }>()
    expect(items.results).toHaveLength(15)
    expect(items.results.every((item) => item.status === 'succeeded')).toBe(true)
    void okStub
  })
})
