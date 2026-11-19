/**
 * Spec 04 (D-87): structured extraction, text path, on both stores (D1 and the Durable Object).
 * Provider HTTP is a stub: nothing here is a paid call or evidence that a real one works.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCsv } from '../../src/domain/csv'
import { EXTRACTION_STARTERS } from '../../src/domain/extraction/starters'
import { MODEL_ROUTES } from '../../src/domain/registry'
import { exportSnapshot, restoreSnapshot } from '../../src/server/services/backup'
import { sweepUnreferencedDocumentBlobs } from '../../src/server/services/documents'
import { UNPARSED_LINE } from '../../src/server/services/extraction'
import { anthropicOk, createHarness, openAiOk, openDeliberation, OTHER, OWNER, REVIEWER, setupOwner, type Harness, type ProviderCall } from './harness'

const schema = EXTRACTION_STARTERS[1].schema // Contact details: fullName must be filled; four may be empty.
const settings = { schema, compare: { '/phone': 'alnum' } }
const DOCUMENT = 'From: Dana Whitfield <dana@fabrikam.example>\nFabrikam Studio, Portland\nPhone: (503) 555-0142\n'
const KEY = { fullName: 'Dana Whitfield', organization: 'Fabrikam Studio', email: 'dana@fabrikam.example', phone: '503 555 0142', city: 'Portland' }
// OpenAI answers exactly; Anthropic invents an organization-free city and drops the phone.
const OPENAI_JSON = '{"city":"Portland","fullName":"Dana Whitfield","organization":"Fabrikam Studio","email":"dana@fabrikam.example","phone":"(503) 555-0142"}'
const ANTHROPIC_JSON = '{\n  "fullName": "Dana Whitfield",\n  "organization": "Fabrikam Studio",\n  "email": "dana@fabrikam.example",\n  "phone": null,\n  "city": "Seattle"\n}'

let h: Harness
afterEach(async () => {
  owners.clear()
  await h.dispose()
})

const jsonStub = async (call: ProviderCall) => (call.url.includes('openai') ? openAiOk(OPENAI_JSON) : anthropicOk(ANTHROPIC_JSON))

const owners = new Map<string, Awaited<ReturnType<typeof setupOwner>>>()

/** A new extraction case; a user's keys are saved once per harness. */
async function extractionCase(user = OWNER) {
  let setup = owners.get(user)
  if (!setup) {
    setup = await setupOwner(h, user)
    owners.set(user, setup)
  } else {
    const created = await h.request('POST', '/evaluations', { as: user, body: { title: 'Another case', taskDescription: '' } })
    setup = { ...setup, evaluationId: created.json.data.id, draft: created.json.data.draft }
  }
  const caseKey = setup.draft.cases[0].key as string
  const draft = {
    ...setup.draft,
    schemaVersion: undefined,
    kit: { version: 'extraction-v1', settings },
    cases: [{ key: caseKey, title: 'Intake email', input: 'Extract the fields from the document.', reference: '', expectedBehavior: 'Check each value against the document.', kitFields: { kind: 'extraction', answerKey: KEY } }],
  }
  delete (draft as Record<string, unknown>).schemaVersion
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: user, ifMatch: 1, body: draft })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  return { setup, caseKey, draft, revision: 2 }
}

async function upload(evaluationId: string, caseKey: string, revision: number, text = DOCUMENT, user = OWNER) {
  return h.request('PUT', `/evaluations/${evaluationId}/documents/${caseKey}`, { as: user, ifMatch: revision, body: { kind: 'text', text } })
}

async function start(setup: Awaited<ReturnType<typeof setupOwner>>, revision: number) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: revision, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

async function count(table: string): Promise<number> {
  return Number((await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0)
}

async function hearing() {
  const { setup, caseKey } = await extractionCase()
  const up = await upload(setup.evaluationId, caseKey, 2)
  expect(up.status, JSON.stringify(up.json)).toBe(200)
  h.setProvider(jsonStub)
  const started = await start(setup, 3)
  expect(started.status, JSON.stringify(started.json)).toBe(202)
  const runId = started.json.data.runId as string
  await h.drainJobs()
  return { setup, caseKey, runId }
}

async function invite(runId: string): Promise<string> {
  const res = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  return new URL(res.json.data.url).hash.replace('#token=', '')
}

function keyNames(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keyNames(item, out)
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) keyNames(entry, out.add(key))
  return out
}

describe('extraction drafts and documents', () => {
  beforeEach(async () => {
    h = await createHarness()
  })

  it('refuses an exhibit, a conversation and an answer key that does not fit, with field paths', async () => {
    const setup = await setupOwner(h)
    const caseKey = setup.draft.cases[0].key
    const { schemaVersion: _v, ...base } = setup.draft
    const bad = { ...base, kit: { version: 'extraction-v1', settings }, cases: [{ key: caseKey, title: 'T', input: 'Extract.', reference: 'not here', expectedBehavior: 'E', kitFields: { kind: 'extraction', answerKey: { fullName: null } } }] }
    const res = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: bad })
    expect(res.status).toBe(422)
    const paths = res.json.error.fields.map((field: { path: string }) => field.path)
    expect(paths).toEqual(expect.arrayContaining(['cases.0.reference', 'cases.0.kitFields.answerKey.fullName']))
    const keyword = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: { ...bad, kit: { version: 'extraction-v1', settings: { schema: { type: 'object', properties: { a: { type: 'string', pattern: 'x' } } }, compare: {} } }, cases: [{ ...bad.cases[0], reference: '', kitFields: { kind: 'extraction' } }] } })
    expect(keyword.status).toBe(422)
    expect(keyword.json.error.fields[0]).toMatchObject({ path: 'kit.settings.schema.properties.a.pattern' })
  })

  it('uploads, dedupes within an owner only, keeps the reference server-side, and removes', async () => {
    const { setup, caseKey, draft } = await extractionCase()
    expect((await upload(setup.evaluationId, caseKey, 1)).status).toBe(409)
    const first = await upload(setup.evaluationId, caseKey, 2)
    expect(first.status).toBe(200)
    expect(first.json.data.document).toMatchObject({ kind: 'text', delivery: 'text', byteLength: new TextEncoder().encode(DOCUMENT).length, pageCount: null })
    expect(first.json.data.revision).toBe(3)
    // A client cannot forge the reference: the server rewrites it from its table on every save.
    const forged = { ...draft, cases: [{ ...draft.cases[0], kitFields: { kind: 'extraction', answerKey: KEY, document: { sha256: 'f'.repeat(64), byteLength: 1, delivery: 'text', pageCount: null } } }] }
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 3, body: forged })).status).toBe(200)
    const view = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    expect(view.draft.cases[0].kitFields.document.sha256).toBe(first.json.data.document.sha256)
    expect(view.documents).toEqual([expect.objectContaining({ caseKey, kind: 'text', sha256: first.json.data.document.sha256, available: true })])
    expect((await h.request('GET', `/evaluations/${setup.evaluationId}/documents/${caseKey}`, { as: OWNER })).json.data).toEqual({ kind: 'text', text: DOCUMENT })
    expect((await h.request('GET', `/evaluations/${setup.evaluationId}/documents/${caseKey}`, { as: OTHER })).status).toBe(404)
    // Same text again (another case of the same owner) reuses the blob; another owner gets their own.
    const second = await extractionCase(OWNER)
    expect((await upload(second.setup.evaluationId, second.caseKey, 2)).status).toBe(200)
    expect(await count('document_blobs')).toBe(1)
    const stranger = await extractionCase(OTHER)
    expect((await upload(stranger.setup.evaluationId, stranger.caseKey, 2, DOCUMENT, OTHER)).status).toBe(200)
    expect(await count('document_blobs')).toBe(2)
    // Remove: the reference goes; the blob stays until the sweep.
    const removed = await h.request('DELETE', `/evaluations/${setup.evaluationId}/documents/${caseKey}`, { as: OWNER, ifMatch: 4 })
    expect(removed.status).toBe(200)
    expect(removed.json.data.draft.cases[0].kitFields.document).toBeUndefined()
    expect((await h.request('GET', `/evaluations/${setup.evaluationId}/documents/${caseKey}`, { as: OWNER })).status).toBe(404)
    const audits = (await h.db.prepare(`SELECT metadata_json FROM audit_events WHERE event_type LIKE 'document.%'`).all<{ metadata_json: string }>()).results.map((row) => row.metadata_json).join('\n')
    expect(audits).not.toContain('Dana')
    expect(audits).toContain('sha256Prefix')
  })

  it('refuses a text that is too large, empty or not a draft extraction question', async () => {
    const { setup, caseKey } = await extractionCase()
    expect((await upload(setup.evaluationId, caseKey, 2, '   ')).status).toBe(422)
    expect((await upload(setup.evaluationId, caseKey, 2, 'x'.repeat(64 * 1024 + 1))).status).toBe(422)
    expect((await upload(setup.evaluationId, crypto.randomUUID(), 2)).status).toBe(422)
  })

  it('an over-quota upload changes nothing', async () => {
    await h.dispose()
    owners.clear()
    h = await createHarness({ env: { MAX_DOCUMENT_BYTES_PER_USER: '40' } })
    const { setup, caseKey } = await extractionCase()
    const res = await upload(setup.evaluationId, caseKey, 2)
    expect(res.status).toBe(429)
    expect(res.json.error.details).toEqual({ kind: 'document_storage' })
    expect(await count('document_blobs')).toBe(0)
    expect(await count('document_blob_chunks')).toBe(0)
    expect(await count('evaluation_documents')).toBe(0)
    expect(await count('document_storage_buckets')).toBe(0)
    expect((await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data.revision).toBe(2)
    expect((await upload(setup.evaluationId, caseKey, 2, 'Short.')).status).toBe(200)
  })

  it('Start is refused without a document, and on a route without a structured-output check, with no provider call', async () => {
    const { setup, caseKey } = await extractionCase()
    const missing = await start(setup, 2)
    expect(missing.status).toBe(422)
    expect(missing.json.error.details.issues[0]).toMatchObject({ kind: 'kit_document_missing', caseKey })
    expect(missing.json.error.message).toContain('Every question needs a document')
    await h.dispose()
    owners.clear()
    h = await createHarness({ routes: MODEL_ROUTES.map((route) => ({ ...route, verifiedAt: '2026-11-16' })) })
    const again = await extractionCase()
    await upload(again.setup.evaluationId, again.caseKey, 2)
    const unverified = await start(again.setup, 3)
    expect(unverified.status).toBe(422)
    expect(unverified.json.error.details.issues.map((issue: { kind: string }) => issue.kind)).toEqual(['structured_unverified', 'structured_unverified'])
    expect(h.providerCalls).toHaveLength(0)
  })
})

describe('extraction hearings', () => {
  beforeEach(async () => {
    h = await createHarness()
  })

  it('freezes the document, sends the wire schema at 2,048 tokens through the feature versions, and checks the answers', async () => {
    const { runId, caseKey } = await hearing()
    const run = await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(runId).first<{ snapshot_json: string }>()
    const snapshot = JSON.parse(run!.snapshot_json)
    expect(snapshot.configurations.map((c: { adapterVersion: string }) => c.adapterVersion)).toEqual(['openai-responses-v3', 'anthropic-messages-v3'])
    expect(snapshot.cases[0].kitFields.document.delivery).toBe('text')
    const frozen = await h.db.prepare('SELECT sha256, delivery FROM run_documents WHERE run_id = ? AND case_key = ?').bind(runId, caseKey).first<{ sha256: string }>()
    expect(frozen!.sha256).toBe(snapshot.cases[0].kitFields.document.sha256)
    await expect(h.db.prepare(`UPDATE run_documents SET delivery = 'pdf_native' WHERE run_id = ?`).bind(runId).run()).rejects.toThrow(/IMMUTABLE_RUN_DOCUMENTS/)
    await expect(h.db.prepare(`UPDATE document_blobs SET byte_length = 1`).run()).rejects.toThrow(/IMMUTABLE_DOCUMENT_BLOBS/)
    await expect(h.db.prepare(`UPDATE document_blob_chunks SET chunk_no = 9`).run()).rejects.toThrow(/IMMUTABLE_DOCUMENT_BLOBS/)

    expect(h.providerCalls).toHaveLength(2)
    const [openai, anthropic] = [h.providerCalls.find((call) => call.url.includes('openai'))!, h.providerCalls.find((call) => call.url.includes('anthropic'))!]
    expect(openai.body.max_output_tokens).toBe(2048)
    expect((openai.body.text as { format: { type: string; strict: boolean; schema: { required: string[] } } }).format).toMatchObject({ type: 'json_schema', name: 'extraction', strict: true })
    expect((openai.body.text as { format: { schema: { required: string[] } } }).format.schema.required).toEqual(['fullName', 'organization', 'email', 'phone', 'city'])
    expect(anthropic.body.max_tokens).toBe(2048)
    expect((anthropic.body.output_config as { format: { type: string } }).format.type).toBe('json_schema')
    const sent = JSON.stringify(h.providerCalls.map((call) => call.body))
    expect(sent).toContain('Dana Whitfield <dana@fabrikam.example>')
    // The answer key and jury instructions never reach a provider.
    expect(sent).not.toContain('503 555 0142')
    expect(sent).not.toContain('Check each value against the document.')
    // No document text in job payloads, logs or audit rows.
    expect(JSON.stringify(h.jobs)).not.toContain('Dana')
    expect(JSON.stringify(h.logs)).not.toContain('Dana')
    const audits = (await h.db.prepare('SELECT metadata_json FROM audit_events').all<{ metadata_json: string }>()).results.map((row) => row.metadata_json).join('\n')
    expect(audits).not.toContain('Fabrikam')

    const checks = (await h.db.prepare('SELECT configuration_key, results_json FROM testimony_checks WHERE run_id = ?').bind(runId).all<{ configuration_key: string; results_json: string }>()).results
    expect(checks).toHaveLength(2)
    const statuses = checks.map((row) => (JSON.parse(row.results_json) as Array<{ checkId: string; status: string }>).map((result) => `${result.checkId}:${result.status}`).join(','))
    expect(statuses.sort()).toEqual(['json-parse:pass,json-schema:pass,required-filled:pass,answer-key:fail', 'json-parse:pass,json-schema:pass,required-filled:pass,answer-key:pass'])
  })

  it('jurors see canonical fields next to the document, and nothing sealed, before unsealing', async () => {
    const { runId } = await hearing()
    await openDeliberation(h, runId)
    expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })).status).toBe(200)
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    expect(review.cases[0].document).toEqual({ kind: 'text', text: DOCUMENT })
    const texts = review.cases[0].responses.map((response: { text: string }) => response.text)
    // Both answers render in the field list's order with the same two-space layout, whatever the provider sent.
    for (const text of texts) expect(Object.keys(JSON.parse(text))).toEqual(['fullName', 'organization', 'email', 'phone', 'city'])
    expect(texts.every((text: string) => text.startsWith('{\n  "fullName": "Dana Whitfield",'))).toBe(true)
    const fields = review.cases[0].responses[0].extraction
    expect(fields.status).toBe('parsed')
    expect(fields.fields.map((row: { label: string }) => row.label)).toEqual(['Name', 'Organization', 'Email', 'Phone', 'City'])
    const guestJoin = await h.request('POST', '/invites/redeem-as-guest', { headers: { Origin: 'https://model-court.test' }, body: { token: await invite(runId), displayName: 'Dana' } })
    const guest = { headers: { Cookie: (guestJoin.headers.get('Set-Cookie') ?? '').split(';')[0] } }
    const payloads = [
      review,
      (await h.request('GET', `/runs/${runId}`, { as: REVIEWER })).json,
      (await h.request('GET', `/runs/${runId}/review`, guest)).json,
      (await h.request('GET', `/runs/${runId}`, guest)).json,
    ]
    for (const payload of payloads) {
      const names = keyNames(payload)
      for (const sealed of ['answerKey', 'checks', 'compare', 'schemaSha256', 'wireSchema', 'kitFields', 'settings']) expect(names.has(sealed), sealed).toBe(false)
      expect(JSON.stringify(payload)).not.toContain('503 555 0142')
    }
    expect((await h.request('GET', `/runs/${runId}/results`, { as: REVIEWER })).status).toBe(409)
  })

  it('an answer that is not JSON shows as text with no fields', async () => {
    const { setup, caseKey } = await extractionCase()
    await upload(setup.evaluationId, caseKey, 2)
    h.setProvider(async (call) => (call.url.includes('openai') ? openAiOk('Sure! Here are the fields: name Dana.') : anthropicOk(ANTHROPIC_JSON)))
    const runId = (await start(setup, 3)).json.data.runId
    await h.drainJobs()
    await openDeliberation(h, runId)
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    const statuses = review.cases[0].responses.map((response: { extraction: { status: string } }) => response.extraction.status).sort()
    expect(statuses).toEqual(['parsed', 'unparsed'])
    expect(UNPARSED_LINE).toContain("isn't valid JSON")
  })

  it('field flags: saved on value rows, refused elsewhere, counted on the record with the Extraction section', async () => {
    const { runId } = await hearing()
    await openDeliberation(h, runId)
    expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })).status).toBe(200)
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    const base = (responseId: string) => ({ responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })
    const [a, b] = review.cases[0].responses
    const badPath = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings: [{ ...base(a.responseId), fieldFlags: [{ path: '/nope', flag: 'invented' }] }] } })
    expect(badPath.status).toBe(422)
    const ratings = [
      { ...base(a.responseId), fieldFlags: [{ path: '/city', flag: 'invented' }, { path: '/phone', flag: 'ambiguous' }] },
      { ...base(b.responseId), fieldFlags: [] },
    ]
    const saved = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings } })
    expect(saved.status, JSON.stringify(saved.json)).toBe(200)
    expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: view.review?.pendingCount ?? 0 } })).status).toBe(200)

    const data = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    const section = data.extraction
    expect(section.schemaSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(section.documents).toEqual([expect.objectContaining({ kind: 'text', text: DOCUMENT })])
    const byKey = Object.fromEntries(section.parties.map((party: { configurationKey: string }) => [party.configurationKey, party]))
    const [openaiKey, anthropicKey] = data.configurations.map((c: { key: string }) => c.key)
    expect(byKey[openaiKey]).toMatchObject({ validJson: 1, requiredFilled: 1, compared: 5, matched: 5, invented: 0, missed: 0 })
    expect(byKey[anthropicKey]).toMatchObject({ validJson: 1, compared: 5, matched: 3, missed: 1 })
    const flagged = section.parties.reduce((sum: number, party: { flaggedInvented: number; flaggedAmbiguous: number }) => sum + party.flaggedInvented + party.flaggedAmbiguous, 0)
    expect(flagged).toBe(2)
    const city = section.cases[0].fields.find((field: { path: string }) => field.path === '/city')
    expect(city.answerKey).toBe('Portland')
    expect(Object.values(city.byParty).map((cell: any) => cell.outcome).sort()).toEqual(['match', 'mismatch'])
    expect(data.cases[0].kitFields.answerKey).toEqual(KEY)
    // Special master is off for extraction (decision 8).
    const grader = await h.request('POST', `/runs/${runId}/special-master`, { as: OWNER, body: { modelKey: 'openai-gpt-6-luna', credentialIdsByProvider: { openai: crypto.randomUUID() }, consentToProviderProcessing: true, acknowledgeProviderCharges: true } })
    expect(grader.status).toBe(409)
    expect(grader.json.error.details).toEqual({ reason: 'kit_unsupported' })
    // Export: the section in JSON, a neutralized field_flags column in CSV.
    const record = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    expect(record.extraction.wireSchema.additionalProperties).toBe(false)
    expect(record.ratings.some((rating: { fieldFlags?: unknown[] }) => (rating.fieldFlags?.length ?? 0) === 2)).toBe(true)
    const csv = (await h.request('GET', `/runs/${runId}/export?format=csv`, { as: OWNER })).text
    const parsed = parseCsv(csv)
    const rows = parsed.ok ? parsed.rows : []
    expect(rows[0].at(-1)).toBe('field_flags')
    expect(rows.slice(1).map((row) => row.at(-1))).toContain('invented:/city;ambiguous:/phone')
  })

  it('field flags are refused on a hearing of another kit', async () => {
    const setup = await setupOwner(h)
    const runId = (await start(setup, 1)).json.data.runId
    await h.drainJobs()
    await openDeliberation(h, runId)
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    const responseId = review.cases[0].responses[0].responseId
    const res = await h.request('PUT', `/runs/${runId}/review`, { as: OWNER, ifMatch: review.sessionRevision, body: { ratings: [{ responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false, fieldFlags: [{ path: '/a', flag: 'invented' }] }] } })
    expect(res.status).toBe(422)
    expect(review.cases[0]).not.toHaveProperty('document')
  })

  it('imported answers must be JSON that fits the field list', async () => {
    const { setup, caseKey, draft } = await extractionCase()
    const importedKey = crypto.randomUUID()
    const withImport = { ...draft, configurations: [draft.configurations[0], { kind: 'imported', key: importedKey, label: 'Data entry', provenance: { sourceType: 'human_baseline', description: 'Typed by the ops team.', redacted: false } }] }
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 2, body: withImport })).status).toBe(200)
    const put = (text: string, ifMatch: number) => h.request('PUT', `/evaluations/${setup.evaluationId}/imports/${importedKey}`, { as: OWNER, ifMatch, body: { items: [{ caseKey, text }], confirmMayShareWithJurors: true } })
    expect((await put('Dana Whitfield', 3)).status).toBe(422)
    expect((await put('{"fullName": "Dana"}', 3)).status).toBe(422)
    expect((await put(JSON.stringify({ ...KEY }), 3)).status).toBe(200)
  })
})

describe('document deletion, sweep and backup', () => {
  beforeEach(async () => {
    h = await createHarness()
  })

  it('the sweep deletes only unreferenced, old blobs, gives bytes back, and is idempotent', async () => {
    const { runId, setup, caseKey } = await hearing()
    // A second, draft-only document that is then removed.
    const other = await extractionCase()
    await upload(other.setup.evaluationId, other.caseKey, 2, 'Another document.')
    await h.request('DELETE', `/evaluations/${other.setup.evaluationId}/documents/${other.caseKey}`, { as: OWNER, ifMatch: 3 })
    const used = Number((await h.db.prepare(`SELECT used_bytes FROM document_storage_buckets WHERE scope = 'global'`).first<{ used_bytes: number }>())!.used_bytes)
    expect(await sweepUnreferencedDocumentBlobs(h.deps)).toBe(0) // too recent
    h.advance(11 * 60_000)
    expect(await sweepUnreferencedDocumentBlobs(h.deps)).toBe(1)
    expect(await sweepUnreferencedDocumentBlobs(h.deps)).toBe(0)
    const after = Number((await h.db.prepare(`SELECT used_bytes FROM document_storage_buckets WHERE scope = 'global'`).first<{ used_bytes: number }>())!.used_bytes)
    expect(used - after).toBe('Another document.'.length)
    // Removing the draft's reference keeps the blob the hearing still uses.
    const revision = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data.revision
    expect((await h.request('DELETE', `/evaluations/${setup.evaluationId}/documents/${caseKey}`, { as: OWNER, ifMatch: revision })).status).toBe(200)
    h.advance(11 * 60_000)
    expect(await sweepUnreferencedDocumentBlobs(h.deps)).toBe(0)
    expect(await count('run_documents')).toBe(1)
    // Purging the case (through its runs) frees it.
    await h.db.prepare('DELETE FROM evaluations WHERE id = ?').bind(setup.evaluationId).run()
    expect(await count('run_documents')).toBe(0)
    expect(await sweepUnreferencedDocumentBlobs(h.deps)).toBe(1)
    expect(Number((await h.db.prepare(`SELECT used_bytes FROM document_storage_buckets WHERE scope = 'global'`).first<{ used_bytes: number }>())!.used_bytes)).toBe(0)
    expect(runId).toBeTruthy()
  })

  it('backups carry text documents whole and the restore recomputes the byte counters', async () => {
    await hearing()
    await h.db.prepare(`UPDATE document_storage_buckets SET used_bytes = 7 WHERE scope = 'global'`).run()
    const snapshot = await exportSnapshot(h.deps)
    expect(snapshot.tables.document_blob_chunks).toHaveLength(1)
    expect(snapshot.redactions.pdfChunksOmitted).toBe(0)
    const target = await createHarness()
    try {
      await restoreSnapshot(target.deps, { ...snapshot, appId: target.deps.config.appId })
      const buckets = (await target.db.prepare('SELECT scope, used_bytes FROM document_storage_buckets ORDER BY scope').all<{ scope: string; used_bytes: number }>()).results
      const bytes = new TextEncoder().encode(DOCUMENT).length
      expect(buckets).toEqual([{ scope: 'global', used_bytes: bytes }, { scope: `user:${OWNER}`, used_bytes: bytes }])
      expect(await target.db.prepare('SELECT COUNT(*) AS n FROM run_documents').first<{ n: number }>()).toEqual({ n: 1 })
    } finally {
      await target.dispose()
    }
  })
})
