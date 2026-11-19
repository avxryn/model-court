/**
 * Spec 05 (D-93 onward): answers from supplied sources, on both stores (D1 and the Durable Object).
 * Provider HTTP is a stub: nothing here is a paid call or evidence that a real one works.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportSnapshot } from '../../src/server/services/backup'
import { anthropicOk, createHarness, openAiOk, openDeliberation, OTHER, OWNER, REVIEWER, setupOwner, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const SOURCES_Q1 = [
  { number: 1, title: 'Refund policy', origin: 'kb-1432 SENTINEL-ORIGIN', text: 'Customers can request a refund within 30 days of purchase. SENTINEL-SOURCE-TEXT' },
  { number: 2, text: 'Refunds go back to the original payment method.' },
  { number: 3, title: 'Warranty', text: 'Hardware is covered for one year from delivery.' },
]
const SOURCES_Q2 = [{ number: 1, title: 'Shipping', text: 'Orders ship within 2 business days.' }]

type Setup = Awaited<ReturnType<typeof setupOwner>>

/** A grounded case with two questions (Q1 answerable citing S1 and S3, Q2 not answerable). */
async function groundedCase(options: { imported?: boolean } = {}) {
  const setup = await setupOwner(h)
  const { schemaVersion: _v, ...base } = setup.draft
  const q1 = crypto.randomUUID()
  const q2 = crypto.randomUUID()
  const provenance = { sourceType: 'human_baseline', description: 'Written by the support lead', redacted: false }
  const configurations = options.imported
    ? [
        { kind: 'imported', key: crypto.randomUUID(), label: 'Human baseline', provenance },
        { kind: 'imported', key: crypto.randomUUID(), label: 'Old bot', provenance },
      ]
    : base.configurations
  const draft = {
    ...base,
    ...(options.imported ? { comparisonMode: 'configuration' } : {}),
    configurations,
    kit: { version: 'grounded-v1', settings: {} },
    cases: [
      { key: q1, title: 'Refunds', input: 'How long do I have to ask for a refund?', reference: '', expectedBehavior: 'SENTINEL-JURY Check each claim.', kitFields: { kind: 'grounded', answerable: 'yes', requiredSources: [1, 3] } },
      { key: q2, title: 'Gift cards', input: 'Can I pay with a gift card?', reference: '', expectedBehavior: 'The sources do not say.', kitFields: { kind: 'grounded', answerable: 'no', requiredSources: [] } },
    ],
  }
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  return { setup, q1, q2, draft, revision: 2 as number }
}

async function putSources(setup: Setup, caseKey: string, revision: number, sources: unknown[], as = OWNER) {
  return h.request('PUT', `/evaluations/${setup.evaluationId}/sources/${caseKey}`, { as, ifMatch: revision, body: { sources } })
}

async function withSources(options: { imported?: boolean } = {}) {
  const made = await groundedCase(options)
  const one = await putSources(made.setup, made.q1, made.revision, SOURCES_Q1)
  expect(one.status, JSON.stringify(one.json)).toBe(200)
  const two = await putSources(made.setup, made.q2, one.json.data.revision, SOURCES_Q2)
  expect(two.status).toBe(200)
  return { ...made, revision: two.json.data.revision as number }
}

async function start(setup: Setup, revision: number, providers?: Record<string, string>) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: revision, credentialIdsByProvider: providers ?? { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  return Number((await h.db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0)
}

describe('grounded sources: drafts', () => {
  it('replaces a question’s sources, records server-side references and returns the owner view', async () => {
    const { setup, q1, q2, revision } = await groundedCase()
    const put = await putSources(setup, q1, revision, SOURCES_Q1)
    expect(put.status, JSON.stringify(put.json)).toBe(200)
    expect(put.json.data.revision).toBe(revision + 1)
    expect(put.json.data.sources.map((source: { number: number }) => source.number)).toEqual([1, 2, 3])
    const fields = put.json.data.draft.cases[0].kitFields
    expect(fields).toMatchObject({ kind: 'grounded', answerable: 'yes', requiredSources: [1, 3] })
    expect(fields.sources).toHaveLength(3)
    expect(fields.sources[0]).toMatchObject({ number: 1, byteLength: new TextEncoder().encode(SOURCES_Q1[0].text).length })
    expect(fields.sources[0].sha256).toMatch(/^[0-9a-f]{64}$/u)

    const view = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    expect(view.sources).toEqual([{ caseKey: q1, items: expect.any(Array) }])
    expect(view.sources[0].items[0]).toMatchObject({ number: 1, title: 'Refund policy', origin: 'kb-1432 SENTINEL-ORIGIN', text: SOURCES_Q1[0].text, sha256: fields.sources[0].sha256 })
    expect(view.sources[0].items[1]).toMatchObject({ number: 2, title: null, origin: null })
    expect(view.sourceTotals.limit).toBe(60_000)
    expect(view.sourceTotals.caseChars).toBe(SOURCES_Q1.reduce((sum, source) => sum + [...source.text].length, 0))
    expect(view.draft.cases[1].kitFields).toEqual({ kind: 'grounded', answerable: 'no', requiredSources: [] })

    // Replacing keeps only the new set.
    const again = await putSources(setup, q1, revision + 1, SOURCES_Q2)
    expect(again.status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM evaluation_sources WHERE case_key = ?', q1)).toBe(1)
    expect(again.json.data.draft.cases[0].kitFields.sources).toHaveLength(1)
    // Delete removes them and the reference.
    const removed = await h.request('DELETE', `/evaluations/${setup.evaluationId}/sources/${q1}`, { as: OWNER, ifMatch: revision + 2 })
    expect(removed.status).toBe(200)
    expect(removed.json.data.draft.cases[0].kitFields.sources).toBeUndefined()
    expect((await h.request('DELETE', `/evaluations/${setup.evaluationId}/sources/${q2}`, { as: OWNER, ifMatch: revision + 3 })).status).toBe(404)
  })

  it('a client cannot forge source references: every draft save takes them from the table', async () => {
    const { setup, q1, draft, revision } = await groundedCase()
    const put = await putSources(setup, q1, revision, SOURCES_Q1)
    const real = put.json.data.draft.cases[0].kitFields.sources
    const forged = { ...draft, cases: [{ ...draft.cases[0], kitFields: { ...draft.cases[0].kitFields, sources: [{ number: 1, sha256: 'f'.repeat(64), byteLength: 1 }] } }, { ...draft.cases[1], kitFields: { ...draft.cases[1].kitFields, sources: [{ number: 1, sha256: 'e'.repeat(64), byteLength: 1 }] } }] }
    const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: revision + 1, body: forged })
    expect(saved.status).toBe(200)
    expect(saved.json.data.draft.cases[0].kitFields.sources).toEqual(real)
    expect(saved.json.data.draft.cases[1].kitFields.sources).toBeUndefined()
    // A question saved without kit fields gets the default key.
    const bare = { ...draft, cases: [{ ...draft.cases[0], kitFields: undefined }] }
    const bareSaved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: revision + 2, body: bare })
    expect(bareSaved.json.data.draft.cases[0].kitFields).toEqual({ kind: 'grounded', answerable: 'yes', requiredSources: [], sources: real })
    // A new case from a scenario file never carries source references (it has no sources yet).
    const imported = await h.request('POST', '/evaluations', { as: OWNER, body: { title: 'From file', taskDescription: '', draft: forged, origin: { kind: 'scenario_file' } } })
    expect(imported.status, JSON.stringify(imported.json)).toBe(201)
    expect(imported.json.data.draft.cases.map((c: { kitFields: { sources?: unknown } }) => c.kitFields.sources)).toEqual([undefined, undefined])
  })

  it('a draft save that drops a question deletes its sources', async () => {
    const { setup, draft, q1, q2, revision } = await withSources()
    expect(await count('SELECT COUNT(*) AS n FROM evaluation_sources WHERE evaluation_id = ?', setup.evaluationId)).toBe(4)
    const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: revision, body: { ...draft, cases: [draft.cases[1]] } })
    expect(saved.status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM evaluation_sources WHERE case_key = ?', q1)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM evaluation_sources WHERE case_key = ?', q2)).toBe(1)
  })

  it('refuses: If-Match missing or stale, validation, the body cap, the case total, unknown questions and other kits', async () => {
    const { setup, q1, q2, revision, draft } = await groundedCase()
    const noMatch = await h.request('PUT', `/evaluations/${setup.evaluationId}/sources/${q1}`, { as: OWNER, body: { sources: SOURCES_Q1 } })
    expect(noMatch.status).toBe(428)
    expect((await putSources(setup, q1, revision - 1, SOURCES_Q1)).status).toBe(409)
    const gap = await putSources(setup, q1, revision, [{ number: 1, text: 'a' }, { number: 3, text: 'b' }])
    expect(gap.status).toBe(422)
    expect(gap.json.error.code).toBe('VALIDATION_FAILED')
    expect((await putSources(setup, q1, revision, [{ number: 1, text: 'x'.repeat(6001) }])).status).toBe(422)
    const huge = await h.request('PUT', `/evaluations/${setup.evaluationId}/sources/${q1}`, { as: OWNER, ifMatch: revision, body: { sources: [{ number: 1, text: 'x'.repeat(140 * 1024) }] } })
    expect(huge.status).toBe(413)
    // 4 × 6,000 on Q1, then Q2 pushes the case past 60,000 only with a third question… so fill Q1 and Q2 to 48,000 and add 12,001.
    const full = (n: number) => Array.from({ length: n }, (_, i) => ({ number: i + 1, text: 'x'.repeat(6000) }))
    const a = await putSources(setup, q1, revision, full(4))
    expect(a.status).toBe(200)
    const b = await putSources(setup, q2, a.json.data.revision, full(4))
    expect(b.status).toBe(200)
    const q3 = crypto.randomUUID()
    const withQ3 = { ...draft, cases: [...draft.cases, { ...draft.cases[0], key: q3, title: 'Third' }] }
    const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: b.json.data.revision, body: withQ3 })
    expect(saved.status).toBe(200)
    const over = await putSources(setup, q3, saved.json.data.revision, [...full(2), { number: 3, text: 'x' }])
    expect(over.status).toBe(422)
    expect(over.json.error.message).toContain('60,000')
    expect((await putSources(setup, q3, saved.json.data.revision, full(2))).status).toBe(200)

    expect((await putSources(setup, crypto.randomUUID(), revision, SOURCES_Q1)).status).toBe(404)
    // Strangers see nothing.
    expect((await putSources(setup, q1, revision, SOURCES_Q1, OTHER)).status).toBe(404)

    const plain = await setupOwner(h, OTHER)
    const notGrounded = await putSources(plain, plain.draft.cases[0].key, 1, SOURCES_Q1, OTHER)
    expect(notGrounded.status).toBe(422)
  })

  it('audits counts only, never titles, notes or text', async () => {
    const { setup } = await withSources()
    const audits = (await h.db.prepare(`SELECT event_type, metadata_json FROM audit_events WHERE event_type LIKE 'evaluation.sources.%'`).all<{ event_type: string; metadata_json: string }>()).results
    expect(audits).toHaveLength(2)
    expect(JSON.parse(audits[0].metadata_json)).toEqual({ caseKey: expect.any(String), count: 3, chars: expect.any(Number) })
    const all = (await h.db.prepare('SELECT metadata_json FROM audit_events').all<{ metadata_json: string }>()).results.map((row) => row.metadata_json).join('\n')
    expect(all).not.toContain('SENTINEL')
    expect(all).not.toContain('Refund policy')
    expect(JSON.stringify(h.logs)).not.toContain('SENTINEL')
    expect(setup.evaluationId).toBeTruthy()
  })
})

describe('grounded sources: readiness and admission', () => {
  it('Start is refused without sources and with a required source that no longer exists', async () => {
    const made = await groundedCase()
    const none = await start(made.setup, made.revision)
    expect(none.status).toBe(422)
    expect(none.json.error.details.issues.map((issue: { kind: string }) => issue.kind)).toEqual(['kit_sources_missing', 'kit_sources_missing'])
    expect(none.json.error.message).toBe('Add at least one source to every question. Q1 has none.')
    const one = await putSources(made.setup, made.q1, made.revision, SOURCES_Q1.slice(0, 2))
    const two = await putSources(made.setup, made.q2, one.json.data.revision, SOURCES_Q2)
    const unknown = await start(made.setup, two.json.data.revision)
    expect(unknown.status).toBe(422)
    expect(unknown.json.error.details.issues).toEqual([{ kind: 'kit_required_source_unknown', caseKey: made.q1, kitVersion: 'grounded-v1', number: 3 }])
    expect(h.providerCalls).toHaveLength(0)
  })

  it('an exhibit or a conversation on a grounded question is refused at save', async () => {
    const { setup, draft, revision } = await groundedCase()
    const bad = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: revision, body: { ...draft, cases: [{ ...draft.cases[0], reference: 'evidence here' }] } })
    expect(bad.status).toBe(422)
    expect(bad.json.error.fields.map((field: { path: string }) => field.path)).toContain('cases.0.reference')
  })

  it('freezes the sources with the snapshot; the copy is immutable and matches the hashes', async () => {
    const made = await withSources({ imported: true })
    const revision = await importAnswers(made)
    const started = await start(made.setup, revision, {})
    expect(started.status, JSON.stringify(started.json)).toBe(202)
    const runId = started.json.data.runId as string
    const rows = (await h.db.prepare('SELECT case_key, number, title, origin, text, sha256 FROM run_sources WHERE run_id = ? ORDER BY case_key, number').bind(runId).all<{ case_key: string; number: number; sha256: string; text: string }>()).results
    expect(rows).toHaveLength(4)
    const snapshot = JSON.parse((await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(runId).first<{ snapshot_json: string }>())!.snapshot_json)
    expect(snapshot.messageTemplateVersion).toBe('grounded-v1')
    expect(snapshot.rubricVersion).toBe('grounded-v1')
    const refs = snapshot.cases.find((c: { key: string }) => c.key === made.q1).kitFields.sources
    expect(rows.filter((row) => row.case_key === made.q1).map((row) => row.sha256)).toEqual(refs.map((ref: { sha256: string }) => ref.sha256))
    expect(JSON.stringify(snapshot)).not.toContain('SENTINEL-SOURCE-TEXT')
    await expect(h.db.prepare('UPDATE run_sources SET text = ? WHERE run_id = ?').bind('changed', runId).run()).rejects.toThrow(/IMMUTABLE_RUN_SOURCES/)
    // Later draft edits never reach the hearing's copy.
    const edited = await putSources(made.setup, made.q1, revision, SOURCES_Q2)
    expect(edited.status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM run_sources WHERE run_id = ? AND case_key = ?', runId, made.q1)).toBe(3)
  })

  it('a source changed under the draft after the snapshot was read fails the start; nothing is written', async () => {
    const made = await withSources({ imported: true })
    const revision = await importAnswers(made)
    await h.db.prepare('UPDATE evaluation_sources SET text = ? WHERE case_key = ? AND number = 1').bind('Tampered text', made.q1).run()
    const started = await start(made.setup, revision, {})
    expect(started.status).toBe(409)
    expect(started.json.error.code).toBe('REVISION_CONFLICT')
    expect(await count('SELECT COUNT(*) AS n FROM runs')).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM run_sources')).toBe(0)
  })

  it('restoring a hearing’s questions brings its sources back; duplicating copies them under the new keys', async () => {
    const made = await withSources({ imported: true })
    const revision = await importAnswers(made)
    const runId = (await start(made.setup, revision, {})).json.data.runId as string
    const changed = await putSources(made.setup, made.q1, revision, SOURCES_Q2)
    const restored = await h.request('POST', `/evaluations/${made.setup.evaluationId}/draft/restore`, { as: OWNER, ifMatch: changed.json.data.revision, body: { fromRunId: runId, questions: true, parties: false } })
    expect(restored.status, JSON.stringify(restored.json)).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM evaluation_sources WHERE case_key = ?', made.q1)).toBe(3)
    const view = (await h.request('GET', `/evaluations/${made.setup.evaluationId}`, { as: OWNER })).json.data
    const q1 = view.sources.find((entry: { caseKey: string }) => entry.caseKey === made.q1)
    expect(q1.items.map((item: { sha256: string }) => item.sha256)).toEqual(view.draft.cases[0].kitFields.sources.map((ref: { sha256: string }) => ref.sha256))

    const copy = await h.request('POST', `/evaluations/${made.setup.evaluationId}/duplicate`, { as: OWNER, body: { title: 'Copy', includeParties: true } })
    expect(copy.status, JSON.stringify(copy.json)).toBe(201)
    const copied = (await h.request('GET', `/evaluations/${copy.json.data.id}`, { as: OWNER })).json.data
    expect(copied.sources).toHaveLength(2)
    expect(copied.sources.map((entry: { caseKey: string }) => entry.caseKey).sort()).toEqual(copied.draft.cases.map((c: { key: string }) => c.key).sort())
    expect(copied.draft.cases[0].kitFields.sources).toEqual(view.draft.cases[0].kitFields.sources)
  })
})

describe('grounded sources: backup and deletion', () => {
  it('both tables are in the store backup', async () => {
    const made = await withSources({ imported: true })
    await start(made.setup, await importAnswers(made), {})
    const snapshot = await exportSnapshot(h.deps)
    const tables = snapshot.tables as unknown as Record<string, unknown[]>
    expect(tables.evaluation_sources).toHaveLength(4)
    expect(tables.run_sources).toHaveLength(4)
  })

  it('a juror cannot write sources', async () => {
    const made = await withSources({ imported: true })
    const runId = (await start(made.setup, await importAnswers(made), {})).json.data.runId as string
    await openDeliberation(h, runId)
    const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
    const token = new URL(invite.json.data.url).hash.replace('#token=', '')
    expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
    const view = (await h.request('GET', `/evaluations/${made.setup.evaluationId}`, { as: OWNER })).json.data
    const refused = await putSources(made.setup, made.q1, view.revision, SOURCES_Q2, REVIEWER)
    expect([403, 404]).toContain(refused.status)
    expect((await h.request('GET', `/evaluations/${made.setup.evaluationId}`, { as: REVIEWER })).json.data.sources).toBeUndefined()
  })
})

/** Answers for both imported parties on both questions; returns the new revision. */
async function importAnswers(made: Awaited<ReturnType<typeof withSources>>): Promise<number> {
  let revision = made.revision
  const answers: Record<string, string> = {
    [made.q1]: 'You have 30 days [S1: "request a refund within 30 days"]; it goes back to your card [S2]. [S9]',
    [made.q2]: 'The sources do not contain the answer.',
  }
  for (const party of made.draft.configurations as Array<{ key: string }>) {
    const items = Object.entries(answers).map(([caseKey, text]) => ({ caseKey, text }))
    const put = await h.request('PUT', `/evaluations/${made.setup.evaluationId}/imports/${party.key}`, { as: OWNER, ifMatch: revision, body: { items, confirmMayShareWithJurors: true } })
    expect(put.status, JSON.stringify(put.json)).toBe(200)
    revision = put.json.data.revision
  }
  return revision
}

const CITED_ANSWER = 'You have 30 days [S1: "request a refund within 30 days"]; it goes back to your card [S2]. See also [S9].'
const groundedStub = async (call: { url: string; body: Record<string, unknown> }) => {
  const asked = JSON.stringify(call.body)
  const text = asked.includes('gift card') ? 'The sources do not contain the answer.' : CITED_ANSWER
  return call.url.includes('openai') ? openAiOk(text) : anthropicOk(text)
}

async function generatedHearing() {
  const made = await withSources()
  h.setProvider(groundedStub)
  const started = await start(made.setup, made.revision)
  expect(started.status, JSON.stringify(started.json)).toBe(202)
  return { ...made, runId: started.json.data.runId as string }
}

async function reveal(runId: string) {
  // The seated juror (REVIEWER) scores every answer and files, then the judge unseals.
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
  const ratings = review.cases.flatMap((c: { responses: Array<{ responseId: string }> }) => c.responses.map((r) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings } })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
  const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
  const revealed = await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: view.review?.pendingCount ?? 0 } })
  expect(revealed.status, JSON.stringify(revealed.json)).toBe(200)
}

function bodyText(call: { body: Record<string, unknown> }): string {
  return JSON.stringify(call.body)
}

describe('grounded sources: generation and checks', () => {
  it('every party gets the same sources in order under grounded-v1; no origin, key or jury text; ids-only jobs', async () => {
    const { runId } = await generatedHearing()
    expect(JSON.stringify(h.jobs)).not.toContain('SENTINEL')
    expect(JSON.stringify(h.jobs)).not.toContain('Refund policy')
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(4)
    for (const call of h.providerCalls) {
      const body = bodyText(call)
      expect(body).toContain('Answer only from the sources.')
      expect(body).toContain('The sources do not contain the answer.')
      for (const leak of ['SENTINEL-ORIGIN', 'kb-1432', 'SENTINEL-JURY', 'answerable', 'requiredSources', 'sha256']) expect(body).not.toContain(leak)
    }
    const refunds = h.providerCalls.filter((call) => bodyText(call).includes('ask for a refund'))
    expect(refunds).toHaveLength(2)
    for (const call of refunds) {
      const body = bodyText(call)
      expect(body).toContain('SENTINEL-SOURCE-TEXT')
      expect(body.indexOf('Refund policy')).toBeLessThan(body.indexOf('original payment method'))
      expect(body.indexOf('original payment method')).toBeLessThan(body.indexOf('Hardware is covered'))
    }
    // Both providers received the same user message.
    const userText = (call: (typeof refunds)[number]) => {
      const body = bodyText(call)
      const from = body.indexOf('The JSON below contains task data')
      return body.slice(from, body.indexOf('ask for a refund', from))
    }
    expect(userText(refunds[0])).toBe(userText(refunds[1]))
    const checks = (await h.db.prepare('SELECT kit_version, results_json FROM testimony_checks WHERE run_id = ?').bind(runId).all<{ kit_version: string; results_json: string }>()).results
    expect(checks).toHaveLength(4)
    expect(checks.every((row) => row.kit_version === 'grounded-v1')).toBe(true)
    const statuses = checks.map((row) => (JSON.parse(row.results_json) as Array<{ checkId: string; status: string }>).map((result) => `${result.checkId}:${result.status}`).join(' ')).sort()
    expect(statuses).toEqual([
      'cites-something:na citations-exist:na quotes-match:na required-cited:na refusal:pass',
      'cites-something:na citations-exist:na quotes-match:na required-cited:na refusal:pass',
      'cites-something:pass citations-exist:fail quotes-match:pass required-cited:fail refusal:pass',
      'cites-something:pass citations-exist:fail quotes-match:pass required-cited:fail refusal:pass',
    ])
    expect(JSON.stringify(h.logs)).not.toContain('SENTINEL')
  })

  it('a source replaced in the hearing’s copy is caught by its hash: unsent, definite, reservation released', async () => {
    const { runId, q1 } = await generatedHearing()
    const row = (await h.db.prepare('SELECT * FROM run_sources WHERE run_id = ? AND case_key = ? AND number = 1').bind(runId, q1).first<Record<string, unknown>>())!
    await h.db.prepare('DELETE FROM run_sources WHERE id = ?').bind(row.id).run()
    await h.db
      .prepare('INSERT INTO run_sources (id, run_id, case_key, number, title, origin, text, sha256, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), runId, q1, 1, row.title, row.origin, 'Refunds within 90 days.', row.sha256, row.byte_length, row.created_at)
      .run()
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(2)
    expect(h.providerCalls.every((call) => bodyText(call).includes('gift card'))).toBe(true)
    const failed = (await h.db.prepare('SELECT g.status, a.error_code FROM generations g JOIN generation_attempts a ON a.generation_id = g.id WHERE g.run_id = ? AND g.case_key = ?').bind(runId, q1).all<{ status: string; error_code: string }>()).results
    expect(failed).toEqual([
      { status: 'failed', error_code: 'INVALID_PROVIDER_RESPONSE' },
      { status: 'failed', error_code: 'INVALID_PROVIDER_RESPONSE' },
    ])
    const states = (await h.db.prepare('SELECT r.state FROM attempt_reservations r JOIN generations g ON g.id = r.generation_id WHERE g.run_id = ? AND g.case_key = ?').bind(runId, q1).all<{ state: string }>()).results
    expect(states).toHaveLength(2)
    expect(states.every((s) => s.state === 'released')).toBe(true)
    expect(h.logs.filter((log) => log.event === 'attempt.sources_mismatch')).toHaveLength(2)
    expect(JSON.stringify(h.logs)).not.toContain('90 days')
  })

  it('imported answers are checked at admission against the frozen sources', async () => {
    const made = await withSources({ imported: true })
    const runId = (await start(made.setup, await importAnswers(made), {})).json.data.runId as string
    const rows = (await h.db.prepare('SELECT imported_output_id, results_json FROM testimony_checks WHERE run_id = ?').bind(runId).all<{ imported_output_id: string; results_json: string }>()).results
    expect(rows).toHaveLength(4)
    expect(rows.every((row) => row.imported_output_id)).toBe(true)
    expect(rows.some((row) => row.results_json.includes('"checkId":"quotes-match","status":"pass"'))).toBe(true)
    expect(rows.some((row) => row.results_json.includes('"status":"error"'))).toBe(false)
  })

  it('jurors see the sources and the key, never origin notes, hashes or check results; results and export have them after unsealing', async () => {
    const { runId, q1 } = await generatedHearing()
    await h.drainJobs()
    await openDeliberation(h, runId)
    const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
    const token = new URL(invite.json.data.url).hash.replace('#token=', '')
    expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    const q = review.cases.find((c: { caseKey: string }) => c.caseKey === q1)
    expect(q.sources.map((s: { number: number; title: string | null }) => [s.number, s.title])).toEqual([[1, 'Refund policy'], [2, null], [3, 'Warranty']])
    expect(q.kitView).toEqual({ kind: 'grounded', answerable: 'yes', requiredSources: [1, 3] })
    expect(q.reference).toBe('')
    const juror = JSON.stringify(review)
    const ownerRun = JSON.stringify((await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data)
    const reviewerRun = JSON.stringify((await h.request('GET', `/runs/${runId}`, { as: REVIEWER })).json.data)
    const assignments = (await h.db.prepare('SELECT assignment_json FROM review_sessions WHERE run_id = ?').bind(runId).all<{ assignment_json: string }>()).results.map((row) => row.assignment_json).join('')
    for (const payload of [juror, ownerRun, reviewerRun, assignments]) {
      for (const leak of ['cites-something', 'citations-exist', 'quotes-match', 'required-cited', '"refusal"', 'checkId', 'SENTINEL-ORIGIN', 'kb-1432']) expect(payload).not.toContain(leak)
    }
    expect(juror).not.toContain('sha256')
    expect((await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).status).toBe(409)

    await reveal(runId)
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.kit).toMatchObject({ version: 'grounded-v1', name: 'Answers from sources' })
    expect(results.checks.metrics.map((metric: { id: string }) => metric.id)).toEqual(['cites-something', 'citations-exist', 'quotes-match', 'required-cited', 'refusal'])
    const r1 = results.cases.find((c: { key: string }) => c.key === q1)
    expect(r1.kitFields).toMatchObject({ kind: 'grounded', answerable: 'yes', requiredSources: [1, 3] })
    expect(r1.responses[0].checks.map((check: { checkId: string }) => check.checkId)).toEqual(['cites-something', 'citations-exist', 'quotes-match', 'required-cited', 'refusal'])
    const frozen = results.grounded.sources.find((entry: { caseKey: string }) => entry.caseKey === q1)
    expect(frozen.items[0]).toMatchObject({ number: 1, origin: 'kb-1432 SENTINEL-ORIGIN', sha256: r1.kitFields.sources[0].sha256 })
    const record = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    expect(record.grounded.sources).toHaveLength(2)
    expect(record.checks.kitVersion).toBe('grounded-v1')
    expect(record.cases.find((c: { key: string }) => c.key === q1).kitFields.answerable).toBe('yes')
  })
})
