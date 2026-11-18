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

/** Imported-only hearings need no key. */
const NO_KEYS = { credentialIdsByProvider: {} }
const provenance = { sourceType: 'human_baseline', description: 'Written by the support lead', redacted: false }

/** Two imported parties with answers on every question: hearings that make no provider call. */
async function setupImportedCase(user = OWNER) {
  const setup = await setupOwner(h, user)
  const base = setup.draft
  const partyA = { kind: 'imported', key: crypto.randomUUID(), label: 'Party A', provenance }
  const partyB = { kind: 'imported', key: crypto.randomUUID(), label: 'Party B', provenance: { ...provenance, description: 'Exported transcripts' } }
  const draft = { ...base, comparisonMode: 'configuration', configurations: [partyA, partyB] }
  let revision = await saveDraftAs(setup, draft, user)
  for (const [index, party] of [partyA, partyB].entries()) {
    const items = base.cases.map((c: any, i: number) => ({ caseKey: c.key, text: `Answer ${i + 1} from ${index === 0 ? 'A' : 'B'}.` }))
    const put = await h.request('PUT', `/evaluations/${setup.evaluationId}/imports/${party.key}`, { as: user, ifMatch: revision, body: { items, confirmMayShareWithJurors: true } })
    expect(put.status).toBe(200)
    revision = put.json.data.revision
  }
  return { ...setup, partyA, partyB }
}

async function saveDraftAs(setup: Setup, draft: any, user: string) {
  const current = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: user })).json.data
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: user, ifMatch: current.revision, body: draftBody(draft) })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  return saved.json.data.revision as number
}

async function count(sql: string, ...binds: unknown[]) {
  return Number((await h.db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0)
}

async function restore(setup: Setup, body: Record<string, unknown>, as = OWNER, ifMatch?: number) {
  const revision = ifMatch ?? (await evaluation(setup)).revision
  return h.request('POST', `/evaluations/${setup.evaluationId}/draft/restore`, { as, ifMatch: revision, body })
}

async function seatJuror(runId: string, juror = REVIEWER) {
  const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  const token = new URL(invite.json.data.url).hash.replace('#token=', '')
  expect((await h.request('POST', '/invites/redeem', { as: juror, body: { token } })).status).toBe(200)
}

describe('re-hear: restore a hearing into the draft (D-69)', () => {
  it('restores questions only, parties only, or both; keeps the earlier hearing untouched', async () => {
    const setup = await setupOwner(h)
    const first = await hearAndUnseal(setup)
    const frozen = await h.db.prepare('SELECT snapshot_json, snapshot_hash FROM runs WHERE id = ?').bind(first).first<any>()
    const original = (await evaluation(setup)).draft
    // Change both questions and parties.
    const changed = structuredClone(original)
    changed.cases[0].input = 'Something else entirely?'
    changed.comparisonMode = 'configuration'
    changed.configurations[0].systemPrompt = 'Be brief.'
    await saveDraft(setup, changed)

    const before = await evaluation(setup)
    const questionsOnly = await restore(setup, { fromRunId: first, questions: true, parties: false })
    expect(questionsOnly.status, JSON.stringify(questionsOnly.json)).toBe(200)
    expect(questionsOnly.json.data.revision).toBe(before.revision + 1)
    let view = await evaluation(setup)
    expect(view.draft.cases).toEqual(original.cases)
    expect(view.draft.configurations[0].systemPrompt).toBe('Be brief.')
    expect(view.draftScenarioVersion).toBe(1)

    expect((await restore(setup, { fromRunId: first, questions: false, parties: true })).status).toBe(200)
    view = await evaluation(setup)
    expect(view.draft.configurations).toEqual(original.configurations)
    expect(view.draft.comparisonMode).toBe('model')

    // Both at once from a fresh edit; the hearing's own rows never change.
    await saveDraft(setup, changed)
    expect((await restore(setup, { fromRunId: first, questions: true, parties: true })).status).toBe(200)
    view = await evaluation(setup)
    expect(draftBody(view.draft)).toEqual(draftBody({ ...original, rubricVersion: 'reference-qa-v1' }))
    expect(await h.db.prepare('SELECT snapshot_json, snapshot_hash FROM runs WHERE id = ?').bind(first).first<any>()).toEqual(frozen)
    const audit = await h.db.prepare(`SELECT metadata_json FROM audit_events WHERE event_type = 'evaluation.restore' ORDER BY created_at`).all<{ metadata_json: string }>()
    expect(audit.results.map((row) => JSON.parse(row.metadata_json))).toEqual([
      { fromRunId: first, questions: true, parties: false },
      { fromRunId: first, questions: false, parties: true },
      { fromRunId: first, questions: true, parties: true },
    ])
  })

  it('restores imported answers byte for byte from the hearing', async () => {
    const setup = await setupImportedCase()
    const started = await start(setup, NO_KEYS)
    const runId = started.json.data.runId as string
    expect((await h.request('POST', `/runs/${runId}/cancel`, { as: OWNER, ifMatch: 1, body: {} })).status).toBe(200)
    const frozen = (await h.db.prepare('SELECT configuration_key, case_key, text, text_sha256, byte_length FROM run_imported_outputs WHERE run_id = ? ORDER BY configuration_key, case_key').bind(runId).all()).results
    // Replace Party A's answers in the draft, then restore the parties.
    const view = await evaluation(setup)
    const edited = view.draft.cases.map((c: any) => ({ caseKey: c.key, text: 'Edited later.' }))
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/imports/${setup.partyA.key}`, { as: OWNER, ifMatch: view.revision, body: { items: edited, confirmMayShareWithJurors: true } })).status).toBe(200)
    const restored = await restore(setup, { fromRunId: runId, questions: false, parties: true })
    expect(restored.status).toBe(200)
    expect(restored.json.data.imports.map((i: any) => i.text)).not.toContain('Edited later.')
    const rows = (await h.db.prepare('SELECT configuration_key, case_key, text, text_sha256, byte_length FROM evaluation_imports WHERE evaluation_id = ? ORDER BY configuration_key, case_key').bind(setup.evaluationId).all()).results
    expect(rows).toEqual(frozen)
  })

  it('refuses a stale revision, an empty restore, another case, jurors and strangers', async () => {
    const setup = await setupOwner(h)
    const started = await start(setup)
    const runId = started.json.data.runId as string
    await h.drainJobs()
    await openDeliberation(h, runId)
    await seatJuror(runId)
    const other = await h.request('POST', '/evaluations', { as: OWNER, body: { title: 'Other', taskDescription: '' } })
    const revision = (await evaluation(setup)).revision
    expect((await restore(setup, { fromRunId: runId, questions: true, parties: true }, OWNER, revision - 1)).status).toBe(409)
    expect((await restore(setup, { fromRunId: runId, questions: false, parties: false })).status).toBe(422)
    const wrongCase = await h.request('POST', `/evaluations/${other.json.data.id}/draft/restore`, { as: OWNER, ifMatch: 1, body: { fromRunId: runId, questions: true, parties: false } })
    expect(wrongCase.status).toBe(404)
    // A juror of this case and a stranger both get 404, as for anything they cannot see.
    expect((await restore(setup, { fromRunId: runId, questions: true, parties: false }, REVIEWER, revision)).status).toBe(404)
    expect((await restore(setup, { fromRunId: runId, questions: true, parties: false }, OTHER, revision)).status).toBe(404)
    expect((await evaluation(setup)).revision).toBe(revision)
  })
})

describe('starting a re-hearing (D-69)', () => {
  it('refuses a different scenario than expected before writing anything, and starts the expected one', async () => {
    const setup = await setupOwner(h)
    const first = await hearAndUnseal(setup)
    const view = await evaluation(setup)
    const expected = view.draftScenarioHash
    const draft = structuredClone(view.draft)
    draft.cases[0].reference = 'A different exhibit.'
    await saveDraft(setup, draft)
    const counts = async () => [
      await count('SELECT COUNT(*) AS n FROM runs WHERE evaluation_id = ?', setup.evaluationId),
      await count('SELECT COUNT(*) AS n FROM run_credentials'),
      await count('SELECT COUNT(*) AS n FROM outbox'),
      await count('SELECT COUNT(*) AS n FROM attempt_reservations'),
      await count('SELECT COALESCE(SUM(allocated_units), 0) AS n FROM budget_buckets'),
    ]
    const before = await counts()
    const refused = await start(setup, { expectedScenarioHash: expected })
    expect(refused.status).toBe(409)
    expect(refused.json.error).toMatchObject({ code: 'STATE_CONFLICT', details: { scenarioChanged: true, scenarioHash: expect.stringMatching(/^[0-9a-f]{64}$/) } })
    expect(refused.json.error.details.scenarioHash).not.toBe(expected)
    expect(await counts()).toEqual(before)

    // Restore hearing 1's questions and start with the matching expectation: new pins, fresh reservations.
    expect((await restore(setup, { fromRunId: first, questions: true, parties: false })).status).toBe(200)
    const firstPins = (await h.db.prepare('SELECT provider, credential_id FROM run_credentials WHERE run_id = ?').bind(first).all()).results
    const started = await start(setup, { expectedScenarioHash: expected })
    expect(started.status, JSON.stringify(started.json)).toBe(202)
    expect(started.json.data.scenarioHash).toBe(expected)
    const second = started.json.data.runId as string
    expect(await count('SELECT COUNT(*) AS n FROM generations WHERE run_id = ?', second)).toBe(10)
    expect(await count('SELECT COUNT(*) AS n FROM attempt_reservations r JOIN generations g ON g.id = r.generation_id WHERE g.run_id = ?', second)).toBe(10)
    expect(await count('SELECT COUNT(*) AS n FROM run_credentials WHERE run_id = ?', second)).toBe(2)
    expect((await h.db.prepare('SELECT provider, credential_id FROM run_credentials WHERE run_id = ?').bind(first).all()).results).toEqual(firstPins)
    const versions = await evaluation(setup)
    expect(versions.runs.find((run: any) => run.id === second).scenarioVersion).toBe(1)
  })

  it('caps a case at 20 hearings, writing nothing for the 21st', async () => {
    const setup = await setupImportedCase()
    for (let i = 0; i < 20; i++) {
      const started = await start(setup, NO_KEYS)
      expect(started.status, `hearing ${i + 1}: ${JSON.stringify(started.json)}`).toBe(202)
      expect((await h.request('POST', `/runs/${started.json.data.runId}/cancel`, { as: OWNER, ifMatch: 1, body: {} })).status).toBe(200)
    }
    const refused = await start(setup, NO_KEYS)
    expect(refused.status).toBe(429)
    expect(refused.json.error.code).toBe('QUOTA_EXHAUSTED')
    expect(refused.json.error.message).toContain('20 hearings')
    expect(await count('SELECT COUNT(*) AS n FROM runs WHERE evaluation_id = ?', setup.evaluationId)).toBe(20)
  })
})
