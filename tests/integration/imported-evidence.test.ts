/**
 * Phase 4 (D-38): imported parties. Their answers are frozen into the hearing,
 * hashed into the snapshot, reviewed blind like generated testimony, and never
 * cost a provider call.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMaintenance } from '../../src/server/services/maintenance'
import { createHarness, OWNER, REVIEWER, setupOwner, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const HUMAN_MARKER = 'HUMAN-BASELINE-ANSWER'
const provenance = { sourceType: 'human_baseline', description: 'Written by the support lead in November', redacted: false }

/** mode 'imported-only': two imported parties; 'mixed': the OpenAI model party plus one imported party. */
async function setupImported(mode: 'imported-only' | 'mixed') {
  const setup = await setupOwner(h)
  const { schemaVersion: _v, ...draft } = setup.draft
  const importedA = { kind: 'imported', key: crypto.randomUUID(), label: 'Human baseline', provenance }
  const importedB = { kind: 'imported', key: crypto.randomUUID(), label: 'Production transcripts', provenance: { ...provenance, sourceType: 'transcript_export', description: 'Exported from the help desk' } }
  const configurations = mode === 'imported-only' ? [importedA, importedB] : [draft.configurations[0], importedA]
  const body = { ...draft, comparisonMode: 'configuration', configurations }
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body })
  expect(saved.status).toBe(200)
  let revision = saved.json.data.revision as number
  for (const [partyIndex, party] of configurations.filter((c: any) => c.kind === 'imported').entries()) {
    const items = draft.cases.map((c: any, i: number) => ({ caseKey: c.key, text: `${HUMAN_MARKER} answer ${i + 1} (${partyIndex === 0 ? 'first' : 'second'} set).` }))
    const put = await h.request('PUT', `/evaluations/${setup.evaluationId}/imports/${party.key}`, { as: OWNER, ifMatch: revision, body: { items, confirmMayShareWithJurors: true } })
    expect(put.status).toBe(200)
    revision = put.json.data.revision
  }
  return { ...setup, draft: body, revision, importedA, importedB }
}

async function start(setup: Awaited<ReturnType<typeof setupImported>>, providers: Record<string, string>) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: setup.revision, credentialIdsByProvider: providers, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

async function bucket(subject: string) {
  return (await h.db.prepare('SELECT allocated_units FROM budget_buckets WHERE subject = ?').bind(subject).first<{ allocated_units: number }>())?.allocated_units ?? 0
}

async function openAndSeatJuror(runId: string) {
  const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
  expect((await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })).status).toBe(200)
  const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  const token = new URL(invite.json.data.url).hash.replace('#token=', '')
  expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
}

describe('imported-only hearings', () => {
  it('need no key, make no provider call, reserve no budget, and start ready', async () => {
    const setup = await setupImported('imported-only')
    const started = await start(setup, {})
    expect(started.status).toBe(202)
    expect(started.json.data).toMatchObject({ status: 'ready', plannedCalls: 0 })
    expect(h.jobs).toHaveLength(0)
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(0)
    expect(await bucket(`user:${OWNER}`)).toBe(0)
    const rows = (await h.db.prepare('SELECT COUNT(*) AS n FROM run_imported_outputs WHERE run_id = ?').bind(started.json.data.runId).first<any>()).n
    expect(rows).toBe(10)
  })

  it('keep the juror view blind: same shape as generated testimony, no source or provenance', async () => {
    const setup = await setupImported('imported-only')
    const runId = (await start(setup, {})).json.data.runId
    await openAndSeatJuror(runId)
    const review = await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })
    expect(review.status).toBe(200)
    for (const c of review.json.data.cases) {
      for (const r of c.responses) {
        expect(Object.keys(r).sort()).toEqual(['label', 'responseId', 'text'])
        expect(r.text).toContain(HUMAN_MARKER)
      }
    }
    const runView = await h.request('GET', `/runs/${runId}`, { as: REVIEWER })
    for (const body of [review.text, runView.text]) {
      for (const leak of ['human_baseline', 'transcript_export', 'support lead', 'help desk', 'imported', 'provenance', 'importedOutputId', 'Human baseline', 'Production transcripts']) {
        expect(body).not.toContain(leak)
      }
    }
  })

  it('label provenance and hashes in the unsealed record and export', async () => {
    const setup = await setupImported('imported-only')
    const runId = (await start(setup, {})).json.data.runId
    await openAndSeatJuror(runId)
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
    const saved = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings } })
    expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } })).status).toBe(200)
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.configurations.map((c: any) => [c.source, c.provenance?.sourceType])).toEqual([
      ['imported', 'human_baseline'],
      ['imported', 'transcript_export'],
    ])
    expect(results.cases[0].responses.every((r: any) => r.status === 'imported' && r.text.includes(HUMAN_MARKER) && /^[0-9a-f]{64}$/.test(r.sha256))).toBe(true)
    expect(results.coverage[setup.importedA.key]).toMatchObject({ source: 'imported', succeeded: 5, planned: 5 })
    const exported = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    expect(JSON.stringify(exported)).toContain('human_baseline')
  })
})

describe('mixed hearings', () => {
  it('reserve and generate only for the model party', async () => {
    const setup = await setupImported('mixed')
    const started = await start(setup, { openai: setup.openaiKeyId })
    expect(started.status).toBe(202)
    expect(started.json.data).toMatchObject({ status: 'generating', plannedCalls: 5 })
    expect(await bucket(`user:${OWNER}`)).toBe(5)
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(5)
    expect(h.providerCalls.every((call) => !JSON.stringify(call.body).includes(HUMAN_MARKER))).toBe(true)
    const view = (await h.request('GET', `/runs/${started.json.data.runId}`, { as: OWNER })).json.data
    expect(view.status).toBe('ready')
    expect(view.imported).toHaveLength(5)
    expect(view.eligibility.caseKeys).toHaveLength(5)
  })

  it('refuse a key for a provider no generated party uses', async () => {
    const setup = await setupImported('mixed')
    const refused = await start(setup, { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId })
    expect(refused.status).toBe(422)
    expect(refused.json.error.code).toBe('CREDENTIAL_MISSING')
  })
})

describe('immutability and admission rules', () => {
  it('freezes answers: the hearing copy cannot be updated and later draft edits do not change it', async () => {
    const setup = await setupImported('imported-only')
    const runId = (await start(setup, {})).json.data.runId
    const before = await h.db.prepare('SELECT snapshot_hash FROM runs WHERE id = ?').bind(runId).first<any>()
    await expect(h.db.prepare(`UPDATE run_imported_outputs SET text = 'tampered' WHERE run_id = ?`).bind(runId).run()).rejects.toThrow(/IMMUTABLE_IMPORTED_OUTPUTS/)
    const items = setup.draft.cases.map((c: any) => ({ caseKey: c.key, text: 'A different answer.' }))
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/imports/${setup.importedA.key}`, { as: OWNER, ifMatch: setup.revision, body: { items, confirmMayShareWithJurors: true } })).status).toBe(200)
    const after = await h.db.prepare('SELECT snapshot_hash FROM runs WHERE id = ?').bind(runId).first<any>()
    expect(after.snapshot_hash).toBe(before.snapshot_hash)
    const texts = (await h.db.prepare('SELECT text FROM run_imported_outputs WHERE run_id = ?').bind(runId).all<any>()).results
    expect(texts.every((row: any) => row.text.includes(HUMAN_MARKER))).toBe(true)
  })

  it('commits the imported bytes into the snapshot hash', async () => {
    const first = await setupImported('imported-only')
    const runA = (await start(first, {})).json.data.runId
    const snapshot = JSON.parse((await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(runA).first<any>()).snapshot_json)
    const imported = snapshot.configurations.find((c: any) => c.source === 'imported')
    expect(imported.imports).toHaveLength(5)
    expect(imported.imports.every((i: any) => /^[0-9a-f]{64}$/.test(i.sha256) && i.byteLength > 0)).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain(HUMAN_MARKER) // texts stay out of the snapshot
  })

  it('refuses a hearing with a missing imported answer, and imports for a model party', async () => {
    const setup = await setupOwner(h)
    const { schemaVersion: _v, ...draft } = setup.draft
    const party = { kind: 'imported', key: crypto.randomUUID(), label: 'Human', provenance }
    const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: { ...draft, comparisonMode: 'configuration', configurations: [draft.configurations[0], party] } })
    const partial = await h.request('PUT', `/evaluations/${setup.evaluationId}/imports/${party.key}`, {
      as: OWNER,
      ifMatch: saved.json.data.revision,
      body: { items: [{ caseKey: draft.cases[0].key, text: 'Only one answer.' }], confirmMayShareWithJurors: true },
    })
    expect(partial.status).toBe(200)
    const refused = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
      as: OWNER,
      body: { draftRevision: partial.json.data.revision, credentialIdsByProvider: { openai: setup.openaiKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(refused.status).toBe(422)
    expect(refused.json.error.message).toMatch(/missing an answer/)
    expect(h.jobs).toHaveLength(0)
    const wrongParty = await h.request('PUT', `/evaluations/${setup.evaluationId}/imports/${draft.configurations[0].key}`, {
      as: OWNER,
      ifMatch: partial.json.data.revision,
      body: { items: [{ caseKey: draft.cases[0].key, text: 'x' }], confirmMayShareWithJurors: true },
    })
    expect(wrongParty.status).toBe(422)
    const stale = await h.request('PUT', `/evaluations/${setup.evaluationId}/imports/${party.key}`, { as: OWNER, ifMatch: 1, body: { items: [{ caseKey: draft.cases[0].key, text: 'x' }], confirmMayShareWithJurors: true } })
    expect(stale.status).toBe(409)
    const noConsent = await h.request('PUT', `/evaluations/${setup.evaluationId}/imports/${party.key}`, { as: OWNER, ifMatch: partial.json.data.revision, body: { items: [{ caseKey: draft.cases[0].key, text: 'x' }] } })
    expect(noConsent.status).toBe(422)
  })

  it('needs configuration mode for an imported party', async () => {
    const setup = await setupImported('mixed')
    const { ...draft } = setup.draft
    const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: setup.revision, body: { ...draft, comparisonMode: 'model' } })
    const refused = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
      as: OWNER,
      body: { draftRevision: saved.json.data.revision, credentialIdsByProvider: { openai: setup.openaiKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(refused.status).toBe(422)
    expect(refused.json.error.code).toBe('UNSUPPORTED_CONFIGURATION')
  })

  it('never logs imported text, and deleting the case purges both tables', async () => {
    const setup = await setupImported('imported-only')
    const runId = (await start(setup, {})).json.data.runId
    const audit = JSON.stringify((await h.db.prepare('SELECT * FROM audit_events').all()).results)
    expect(audit).not.toContain(HUMAN_MARKER)
    expect(JSON.stringify(h.logs)).not.toContain(HUMAN_MARKER)
    const current = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    expect(current.imports).toHaveLength(10)
    const removed = await h.request('DELETE', `/evaluations/${setup.evaluationId}`, { as: OWNER, ifMatch: current.revision, body: { confirmTitle: current.title } })
    expect(removed.status).toBe(202)
    await runMaintenance(h.deps)
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM evaluation_imports').first<any>()).n).toBe(0)
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM run_imported_outputs WHERE run_id = ?').bind(runId).first<any>()).n).toBe(0)
  })
})
