/**
 * Spec 02: scenario versions, re-hearing, comparison, copies and scenario
 * files. Hearings here use the fake provider stub or imported parties, so no
 * real provider is ever called.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportSnapshot, restoreSnapshot } from '../../src/server/services/backup'
import { runMaintenance } from '../../src/server/services/maintenance'
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
async function hearAndUnseal(setup: Setup, extra: Record<string, unknown> = {}): Promise<string> {
  const started = await start(setup, extra)
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

/** A hearing with REVIEWER as juror: fake providers answer, juror and judge file, the judge unseals. */
async function hearWithJury(setup: Setup, score = (index: number) => ({ correctness: 2, completeness: 1, grounding: 2, index })) {
  const started = await start(setup)
  expect(started.status, JSON.stringify(started.json)).toBe(202)
  const runId = started.json.data.runId as string
  await h.drainJobs()
  await openDeliberation(h, runId)
  await seatJuror(runId)
  for (const user of [REVIEWER, OWNER]) {
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: user })).json.data
    const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any, i: number) => {
      const { index: _i, ...lines } = score(i)
      return { responseId: r.responseId, ...lines, note: '', suspectedIdentityClue: false }
    }))
    const saved = await h.request('PUT', `/runs/${runId}/review`, { as: user, ifMatch: review.sessionRevision, body: { ratings } })
    expect(saved.status).toBe(200)
    expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: user, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
  }
  const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
  const revealed = await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: view.review.pendingCount } })
  expect(revealed.status, JSON.stringify(revealed.json)).toBe(200)
  return runId
}

describe('comparing hearings (D-70)', () => {
  it('lines up unsealed hearings through the anchor, marks the repeat juror, and leaks no account id', async () => {
    const setup = await setupOwner(h)
    const first = await hearWithJury(setup)
    const draft = (await evaluation(setup)).draft
    draft.comparisonMode = 'configuration'
    draft.configurations[1].systemPrompt = 'Answer in one sentence.'
    await saveDraft(setup, draft)
    const second = await hearWithJury(setup)

    const res = await h.request('GET', `/evaluations/${setup.evaluationId}/comparison?runIds=${second},${first}`, { as: OWNER })
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    const data = res.json.data
    expect(data.hearings.map((hearing: any) => hearing.runId)).toEqual([first, second])
    expect(data.hearings.map((hearing: any) => hearing.raterSource)).toEqual(['jury', 'jury'])
    expect(data.hearings.map((hearing: any) => hearing.repeatJurorCount)).toEqual([0, 1])
    expect(data.comparable).toMatchObject({ sameQuestions: true, sameRubric: true, sameTemplate: true, sameRaterSource: true })
    expect(data.commonQuestionCount).toBe(5)
    expect(data.anchors).toHaveLength(1)
    expect(data.anchors[0].label).toBe('Candidate 1')
    // Every line scored 2/1/2 = 5 points, so the anchor difference is 0 on every question.
    expect(data.anchors[0].byHearing[first]).toMatchObject({ meanPoints: 5, questions: 5, raters: 1 })
    expect(data.relative).toEqual([
      expect.objectContaining({ runId: first, label: 'Candidate 2', meanDiff: 0, tied: 5, questions: 5, raters: 1 }),
      expect.objectContaining({ runId: second, label: 'Candidate 2', meanDiff: 0, tied: 5, questions: 5, raters: 1 }),
    ])
    expect(data.jurorOverlap).toEqual([{ runIds: [first, second], shared: 1, knowable: 1, guests: 0 }])
    expect(data.caveats).toEqual(expect.arrayContaining(['different_juries', 'few_raters', 'repeat_jurors']))
    expect(data.setupMetrics[first]).toBeDefined()
    expect(Object.keys(data.setupMetrics[first]).sort()).toEqual(data.hearings[0].parties.map((p: any) => p.key).sort())
    const body = JSON.stringify(res.json)
    for (const secret of [REVIEWER, OWNER, setup.openaiKeyId, setup.anthropicKeyId, 'sk-']) expect(body).not.toContain(secret)
  })

  it('refuses sealed hearings (409), bad lists (422), other cases (404), jurors and strangers (404)', async () => {
    const setup = await setupOwner(h)
    const first = await hearWithJury(setup)
    const sealed = (await start(setup)).json.data.runId as string
    await h.drainJobs()
    const path = (ids: string[]) => `/evaluations/${setup.evaluationId}/comparison?runIds=${ids.join(',')}`
    const refused = await h.request('GET', path([first, sealed]), { as: OWNER })
    expect(refused.status).toBe(409)
    expect(refused.json.error.details).toEqual({ sealedRunId: sealed })
    expect((await h.request('GET', path([first]), { as: OWNER })).status).toBe(422)
    expect((await h.request('GET', path([first, first]), { as: OWNER })).status).toBe(422)
    expect((await h.request('GET', path([first, crypto.randomUUID()]), { as: OWNER })).status).toBe(404)
    expect((await h.request('GET', path([first, sealed]), { as: REVIEWER })).status).toBe(404)
    expect((await h.request('GET', path([first, sealed]), { as: OTHER })).status).toBe(404)
  })
})

async function duplicate(setup: Setup, body: Record<string, unknown>, idempotencyKey = crypto.randomUUID(), as = OWNER) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/duplicate`, { as, idempotencyKey, body: { title: 'Copy', ...body } })
}

describe('copies and scenario files (D-71)', () => {
  it('duplicates the draft with fresh keys, copies no hearing, key or session, and sets the origin once', async () => {
    const setup = await setupImportedCase()
    const runId = (await start(setup, NO_KEYS)).json.data.runId as string
    const sourceView = await evaluation(setup)
    const key = crypto.randomUUID()
    const copied = await duplicate(setup, { includeParties: true }, key)
    expect(copied.status, JSON.stringify(copied.json)).toBe(201)
    const copyId = copied.json.data.id as string
    // Same key and body replay the same answer; nothing new is created.
    const replay = await duplicate(setup, { includeParties: true }, key)
    expect(replay.json.data.id).toBe(copyId)
    expect(await count('SELECT COUNT(*) AS n FROM evaluations WHERE owner_user_id = ?', OWNER)).toBe(2)

    const copy = (await h.request('GET', `/evaluations/${copyId}`, { as: OWNER })).json.data
    expect(copy.title).toBe('Copy')
    expect(copy.runs).toEqual([])
    expect(copy.imports).toEqual([])
    expect(copy.draft.cases.map((c: any) => c.key)).not.toEqual(sourceView.draft.cases.map((c: any) => c.key))
    expect(copy.draft.configurations.map((c: any) => c.key)).not.toEqual(sourceView.draft.configurations.map((c: any) => c.key))
    expect(copy.draft.configurations.map((c: any) => c.label)).toEqual(['Party A', 'Party B'])
    expect(copy.draftScenarioHash).toBe(sourceView.draftScenarioHash)
    expect(copy.origin).toEqual({ kind: 'duplicate', fromEvaluationId: setup.evaluationId, fromRunId: null, scenarioHash: sourceView.draftScenarioHash, sourceDeleted: false })
    expect((await evaluation(setup)).copyCount).toBe(1)
    for (const table of ['review_sessions', 'run_credentials', 'verdict_revisions', 'invites']) expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE run_id IN (SELECT id FROM runs WHERE evaluation_id = ?)`, copyId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM runs WHERE evaluation_id = ?', copyId)).toBe(0)
    // The origin can never be rewritten.
    await expect(h.db.prepare(`UPDATE evaluations SET origin_kind = 'scenario_file' WHERE id = ?`).bind(copyId).run()).rejects.toThrow(/IMMUTABLE_EVALUATIONS/)

    // Imported answers come only when asked, and from a hearing they come as frozen.
    const withAnswers = await duplicate(setup, { includeParties: true, includeImportedAnswers: true, fromRunId: runId })
    expect(withAnswers.status).toBe(201)
    const answered = (await h.request('GET', `/evaluations/${withAnswers.json.data.id}`, { as: OWNER })).json.data
    expect(answered.imports).toHaveLength(10)
    const frozen = (await h.db.prepare('SELECT text FROM run_imported_outputs WHERE run_id = ? ORDER BY text').bind(runId).all<{ text: string }>()).results.map((row) => row.text)
    expect(answered.imports.map((row: any) => row.text).sort()).toEqual(frozen.sort())
    expect(answered.origin).toMatchObject({ kind: 'duplicate', fromRunId: runId })
    expect((await duplicate(setup, { includeParties: false, includeImportedAnswers: true })).status).toBe(422)
    // Without parties the copy gets the default pair.
    const bare = await duplicate(setup, { includeParties: false })
    const bareView = (await h.request('GET', `/evaluations/${bare.json.data.id}`, { as: OWNER })).json.data
    expect(bareView.draft.configurations.map((c: any) => c.label)).toEqual(['Candidate 1', 'Candidate 2'])
  })

  it('counts copies against the case quota, and refuses jurors and strangers', async () => {
    const setup = await setupOwner(h)
    for (let i = 1; i < 10; i++) expect((await duplicate(setup, { includeParties: true })).status).toBe(201)
    const refused = await duplicate(setup, { includeParties: true })
    expect(refused.status).toBe(429)
    expect(refused.json.error.code).toBe('QUOTA_EXHAUSTED')
    expect(await count('SELECT COUNT(*) AS n FROM evaluations WHERE owner_user_id = ?', OWNER)).toBe(10)
    expect((await duplicate(setup, { includeParties: true }, crypto.randomUUID(), OTHER)).status).toBe(404)
  })

  it('creates a case from an imported draft, validated and with a server-computed origin', async () => {
    const setup = await setupOwner(h)
    const source = await evaluation(setup)
    const draft = draftBody(source.draft)
    const created = await h.request('POST', '/evaluations', { as: OWNER, body: { title: 'Imported', taskDescription: '', draft, origin: { kind: 'scenario_file' } } })
    expect(created.status, JSON.stringify(created.json)).toBe(201)
    const view = (await h.request('GET', `/evaluations/${created.json.data.id}`, { as: OWNER })).json.data
    expect(view.origin).toEqual({ kind: 'scenario_file', fromEvaluationId: null, fromRunId: null, scenarioHash: source.draftScenarioHash, sourceDeleted: false })
    expect(view.draftScenarioHash).toBe(source.draftScenarioHash)
    // Unknown fields, an origin without a draft, and an over-cap draft are refused; nothing is created.
    const before = await count('SELECT COUNT(*) AS n FROM evaluations')
    expect((await h.request('POST', '/evaluations', { as: OWNER, body: { title: 'x', taskDescription: '', draft: { ...draft, secret: 1 } } })).status).toBe(422)
    expect((await h.request('POST', '/evaluations', { as: OWNER, body: { title: 'x', taskDescription: '', origin: { kind: 'scenario_file' } } })).status).toBe(422)
    expect((await h.request('POST', '/evaluations', { as: OWNER, body: { title: 'x', taskDescription: '', draft, origin: { kind: 'duplicate' } } })).status).toBe(422)
    expect(await count('SELECT COUNT(*) AS n FROM evaluations')).toBe(before)
  })

  it('exports a scenario file without ids, keys or answers; from a hearing it matches that snapshot', async () => {
    const setup = await setupImportedCase()
    const draft = (await evaluation(setup)).draft
    draft.configurations.push({ key: crypto.randomUUID(), label: 'Model party', modelKey: 'openai-gpt-6-luna', systemPrompt: 'CONFIDENTIAL PROMPT', maxOutputTokens: 512 })
    await saveDraft(setup, draft)
    const runId = await hearAndUnseal(setup, { credentialIdsByProvider: { openai: setup.openaiKeyId } })
    const view = await evaluation(setup)
    const res = await h.request('GET', `/evaluations/${setup.evaluationId}/scenario?includeParties=false`, { as: OWNER })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="MC-[0-9A-F]{4}-[0-9A-F]{4}-scenario\.json"/)
    const file = res.json.data
    expect(file).toMatchObject({ format: 'model-court-scenario', formatVersion: 1, scenarioHashVersion: 'scenario-v1', scenarioHash: view.draftScenarioHash, rubricVersion: 'reference-qa-v1', messageTemplateVersion: 'qa-v1' })
    expect(file.questions).toHaveLength(5)
    expect(file.parties).toBeUndefined()
    const body = JSON.stringify(file)
    const ids = [setup.evaluationId, runId, setup.openaiKeyId, setup.anthropicKeyId, OWNER, ...view.draft.cases.map((c: any) => c.key), ...view.draft.configurations.map((c: any) => c.key)]
    for (const secret of [...ids, 'sk-', 'CONFIDENTIAL PROMPT', 'Answer 1 from A']) expect(body).not.toContain(secret)

    const withParties = (await h.request('GET', `/evaluations/${setup.evaluationId}/scenario?includeParties=true&fromRunId=${runId}`, { as: OWNER })).json.data
    expect(withParties.scenarioHash).toBe(view.runs.find((run: any) => run.id === runId).scenarioHash)
    expect(withParties.parties).toEqual([{ label: 'Model party', modelKey: 'openai-gpt-6-luna', provider: 'openai', modelId: expect.any(String), systemPrompt: 'CONFIDENTIAL PROMPT' }])
    expect(withParties.importedPartiesLeftOut).toBe(2)
    expect(JSON.stringify(withParties)).not.toContain('Answer 1 from A')
    expect((await h.request('GET', `/evaluations/${setup.evaluationId}/scenario?includeParties=yes`, { as: OWNER })).status).toBe(400)
    expect((await h.request('GET', `/evaluations/${setup.evaluationId}/scenario`, { as: OTHER })).status).toBe(404)
    const audit = await h.db.prepare(`SELECT metadata_json FROM audit_events WHERE event_type = 'scenario.export'`).all<{ metadata_json: string }>()
    expect(audit.results.map((row) => JSON.parse(row.metadata_json))).toEqual([{ fromRunId: null, includeParties: false }, { fromRunId: runId, includeParties: true }])
  })

  it('keeps a copy when its source is deleted and purged, and says so', async () => {
    const setup = await setupOwner(h)
    const copyId = (await duplicate(setup, { includeParties: true })).json.data.id as string
    const source = await evaluation(setup)
    expect((await h.request('DELETE', `/evaluations/${setup.evaluationId}`, { as: OWNER, ifMatch: source.revision, body: { confirmTitle: source.title } })).status).toBe(202)
    h.advance(48 * 3_600_000)
    await runMaintenance(h.deps)
    expect(await count('SELECT COUNT(*) AS n FROM evaluations WHERE id = ?', setup.evaluationId)).toBe(0)
    const copy = (await h.request('GET', `/evaluations/${copyId}`, { as: OWNER })).json.data
    expect(copy.origin).toMatchObject({ kind: 'duplicate', fromEvaluationId: setup.evaluationId, sourceDeleted: true })
    expect(copy.draft.cases).toHaveLength(5)
  })

  it('backs up and restores the origin columns', async () => {
    const setup = await setupOwner(h)
    const copyId = (await duplicate(setup, { includeParties: true })).json.data.id as string
    const target = await createHarness()
    try {
      await restoreSnapshot(target.deps, await exportSnapshot(h.deps))
      const row = await target.db.prepare('SELECT origin_kind, origin_evaluation_id, origin_run_id, origin_scenario_hash FROM evaluations WHERE id = ?').bind(copyId).first<any>()
      expect(row).toEqual({ origin_kind: 'duplicate', origin_evaluation_id: setup.evaluationId, origin_run_id: null, origin_scenario_hash: expect.stringMatching(/^[0-9a-f]{64}$/) })
    } finally {
      await target.dispose()
    }
  })
})
