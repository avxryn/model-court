/**
 * Spec 02: scenario versions, re-hearing, comparison, copies and scenario
 * files. Hearings here use the fake provider stub or imported parties, so no
 * real provider is ever called.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, openDeliberation, OTHER, OWNER, REVIEWER, setupOwner, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

type Setup = Awaited<ReturnType<typeof setupOwner>>

async function evaluation(setup: Setup, as = OWNER) {
  return (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as })).json.data
}

function draftBody(draft: any) {
  const { schemaVersion: _v, ...body } = draft
  return body
}

async function saveDraft(setup: Setup, draft: any) {
  const current = await evaluation(setup)
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: current.revision, body: draftBody(draft) })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  return saved.json.data.revision as number
}

async function start(setup: Setup, extra: Record<string, unknown> = {}) {
  // Hearings of one case never share a start time (one unfinished hearing at a time).
  h.advance(60_000)
  const current = await evaluation(setup)
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: current.revision, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true, ...extra },
  })
}

function fullRatings(review: any) {
  return review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 1, grounding: 2, note: '', suspectedIdentityClue: false })))
}

/** Start a hearing on the saved draft, let the fake providers answer, then the judge files alone and unseals. */
async function hearAndUnseal(setup: Setup): Promise<string> {
  const started = await start(setup)
  expect(started.status, JSON.stringify(started.json)).toBe(202)
  const runId = started.json.data.runId as string
  await h.drainJobs()
  await openDeliberation(h, runId)
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: OWNER, ifMatch: review.sessionRevision, body: { ratings: fullRatings(review) } })
  expect(saved.status).toBe(200)
  const filed = await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: saved.json.data.sessionRevision, body: {} })
  expect(filed.status, JSON.stringify(filed.json)).toBe(200)
  return runId
}

describe('scenario versions on the case page (D-68)', () => {
  it('groups hearings by questions, lists parties only once unsealed, and says what changed', async () => {
    const setup = await setupOwner(h)
    let view = await evaluation(setup)
    expect(view.draftScenarioVersion).toBeNull()
    expect(view.nextScenarioVersion).toBe(1)
    expect(view.draftScenarioHash).toMatch(/^[0-9a-f]{64}$/)

    const first = await hearAndUnseal(setup)
    // Same questions, a different system prompt for Candidate 2.
    const draft = (await evaluation(setup)).draft
    draft.configurations[1].systemPrompt = 'Answer in one sentence.'
    draft.comparisonMode = 'configuration'
    await saveDraft(setup, draft)
    view = await evaluation(setup)
    expect(view.draftScenarioVersion).toBe(1)
    expect(view.draftDiff).toBeNull()

    const second = (await start(setup)).json.data.runId as string
    await h.drainJobs()
    view = await evaluation(setup)
    const sealed = view.runs.find((run: any) => run.id === second)
    expect(sealed).toMatchObject({ scenarioVersion: 1, number: 2, partyCount: 2, parties: null, changes: null })
    const unsealed = view.runs.find((run: any) => run.id === first)
    expect(unsealed).toMatchObject({ scenarioVersion: 1, number: 1, partyCount: 2, changes: null })
    expect(unsealed.parties.map((p: any) => p.label)).toEqual(['Candidate 1', 'Candidate 2'])
    expect(unsealed.parties[0]).toEqual({ key: expect.any(String), label: 'Candidate 1', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), source: 'model', provider: 'openai', modelId: expect.any(String) })
    expect(unsealed.scenarioHash).toBe(sealed.scenarioHash)

    // Unseal hearing 2: its changes versus hearing 1 appear.
    await openDeliberation(h, second)
    const review = (await h.request('GET', `/runs/${second}/review`, { as: OWNER })).json.data
    const saved = await h.request('PUT', `/runs/${second}/review`, { as: OWNER, ifMatch: review.sessionRevision, body: { ratings: fullRatings(review) } })
    expect((await h.request('POST', `/runs/${second}/review/file-and-unseal`, { as: OWNER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
    view = await evaluation(setup)
    expect(view.runs.find((run: any) => run.id === second).changes).toEqual([{ kind: 'prompt', label: 'Candidate 2' }])
    // The anchor (Candidate 1) has the same fingerprint in both hearings.
    const fingerprints = view.runs.map((run: any) => run.parties[0].fingerprint)
    expect(new Set(fingerprints).size).toBe(1)

    // Editing a question makes the draft a new version, with a diff against the newest hearing.
    const next = (await evaluation(setup)).draft
    next.cases[0].input = `${next.cases[0].input} (edited)`
    next.cases[1].title = 'Retitled only'
    await saveDraft(setup, next)
    view = await evaluation(setup)
    expect(view.draftScenarioVersion).toBeNull()
    expect(view.nextScenarioVersion).toBe(2)
    expect(view.draftDiff).toMatchObject({ added: [], removed: [], edited: [{ fromKey: next.cases[0].key, toKey: next.cases[0].key }], rubricChanged: false })
  })

  it('is owner-only: the juror view of the case is unchanged', async () => {
    const setup = await setupOwner(h)
    const started = await start(setup)
    const runId = started.json.data.runId as string
    await h.drainJobs()
    await openDeliberation(h, runId)
    const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
    const token = new URL(invite.json.data.url).hash.replace('#token=', '')
    expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
    const juror = await evaluation(setup, REVIEWER)
    expect(Object.keys(juror).sort()).toEqual(['id', 'role', 'runs', 'title'])
    expect(Object.keys(juror.runs[0]).sort()).toEqual(['createdAt', 'id', 'status'])
    expect((await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OTHER })).status).toBe(404)
  })
})
