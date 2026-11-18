/**
 * Certified record export: owner-only, after reveal; JSON and formula-safe
 * CSV; never carries keys, ciphertext, invite tokens, or user/session IDs.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCsv } from '../../src/domain/csv'
import { RECORD_CSV_HEADER } from '../../src/server/services/export'
import { anthropicOk, createHarness, openAiOk, openDeliberation, OTHER, OWNER, REVIEWER, setupOwner, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const FORMULA_TITLE = '=cmd|"/c calc"!A1'
const FORMULA_NOTE = '=HYPERLINK("https://attacker.test","click")'

async function runView(runId: string) {
  return (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
}

async function submit(runId: string, user: string, score: 0 | 1 | 2, note = '') {
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: user })).json.data
  const ratings = review.cases.flatMap((c: any) =>
    c.responses.map((r: any) => ({ responseId: r.responseId, correctness: score, completeness: score, grounding: score, note: note || (score === 0 ? 'Contradicts the reference policy.' : ''), suspectedIdentityClue: false })),
  )
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: user, ifMatch: review.sessionRevision, body: { ratings } })
  expect(saved.status).toBe(200)
  expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: user, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
}

/** A run with one invited juror and the judge, in `reviewing`. */
async function reviewingRun() {
  const setup = await setupOwner(h)
  const { schemaVersion: _v, ...draft } = setup.draft
  draft.cases[0].title = FORMULA_TITLE
  expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })).status).toBe(200)
  const started = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: 2, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
  const runId = started.json.data.runId as string
  await h.drainJobs()
  let view = await runView(runId)
  await openDeliberation(h, runId)
  const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  const token = new URL(invite.json.data.url).hash.replace('#token=', '')
  expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
  await submit(runId, REVIEWER, 2, FORMULA_NOTE)
  await submit(runId, OWNER, 1)
  view = await runView(runId)
  return { setup, runId, token, view }
}

async function reveal(runId: string) {
  const view = await runView(runId)
  expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 0 } })).status).toBe(200)
}

async function secrets(token: string) {
  const strings = async (sql: string) => (await h.db.prepare(sql).all<Record<string, string | null>>()).results.flatMap((row) => Object.values(row)).filter((v): v is string => typeof v === 'string' && v.length > 0)
  const assignments = (await strings('SELECT assignment_json FROM review_sessions')).flatMap((json) => JSON.parse(json).flatMap((c: any) => c.responses.flatMap((r: any) => [r.responseId, r.generationId, r.acceptedAttemptId])))
  return [
    'sk-test-SENTINEL-OPENAI-KEY',
    'sk-ant-SENTINEL-ANTHROPIC-KEY',
    'SENTINEL',
    token,
    OWNER,
    REVIEWER,
    ...(await strings('SELECT id, ciphertext, nonce FROM provider_credentials')),
    ...(await strings('SELECT id, token_hash FROM invites')),
    ...(await strings('SELECT id FROM review_sessions')),
    ...(await strings('SELECT id FROM generations')),
    ...(await strings('SELECT id FROM generation_attempts')),
    ...assignments,
  ]
}

describe('certified record export', () => {
  it('is owner-only and available only after reveal', async () => {
    const { runId } = await reviewingRun()
    const early = await h.request('GET', `/runs/${runId}/export`, { as: OWNER })
    expect(early.status).toBe(409)
    expect(early.json.error.code).toBe('STATE_CONFLICT')
    expect((await h.request('GET', `/runs/${runId}/export?format=csv`, { as: OWNER })).status).toBe(409)
    await reveal(runId)
    expect((await h.request('GET', `/runs/${runId}/export`, { as: REVIEWER })).status).toBe(403)
    expect((await h.request('GET', `/runs/${runId}/export?format=csv`, { as: REVIEWER })).status).toBe(403)
    expect((await h.request('GET', `/runs/${runId}/export`, { as: OTHER })).status).toBe(404)
    expect((await h.request('GET', `/runs/${runId}/export`, {})).status).toBe(401)
    const bad = await h.request('GET', `/runs/${runId}/export?format=xlsx`, { as: OWNER })
    expect(bad.status).toBe(400)
  })

  it('JSON carries cases, responses, labeled ratings, verdicts, and versions; the content hash is deterministic', async () => {
    const { runId, token } = await reviewingRun()
    await reveal(runId)
    const first = await h.request('GET', `/runs/${runId}/export`, { as: OWNER })
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('private, no-store')
    expect(first.headers.get('Content-Disposition')).toBe(`attachment; filename="model-court-record-${runId}.json"`)
    const record = first.json.data
    const run = await h.db.prepare('SELECT snapshot_hash FROM runs WHERE id = ?').bind(runId).first<{ snapshot_hash: string }>()
    expect(record).toMatchObject({
      format: 'model-court-certified-record',
      formatVersion: 1,
      run: { runId, status: 'revealed', comparisonMode: 'model' },
      versions: { snapshotHash: run!.snapshot_hash, rubricVersion: 'reference-qa-v1', canonicalization: 'sorted-json-v1', appCommit: 'test-commit' },
      exportedAt: new Date(h.now()).toISOString(),
    })
    expect(record.cases).toHaveLength(5)
    expect(record.cases[0]).toMatchObject({ number: 1, title: FORMULA_TITLE, eligible: true })
    expect(record.cases[0].expectedBehavior).toBeTruthy()
    expect(record.responses).toHaveLength(10)
    expect(record.responses.every((r: any) => r.status === 'succeeded' && r.text)).toBe(true)
    expect(record.ratings).toHaveLength(20)
    expect(new Set(record.ratings.map((r: any) => r.juror))).toEqual(new Set(['Juror 1', 'Judge (context-aware)']))
    expect(record.ratings.find((r: any) => r.juror === 'Juror 1').note).toBe(FORMULA_NOTE) // JSON keeps text exact
    expect(record.findings.cohorts.invited.reviewerCount).toBe(1)
    expect(record.verdicts).toEqual([])
    expect(record.certification.contentSha256).toMatch(/^[0-9a-f]{64}$/)

    h.advance(60_000)
    const again = (await h.request('GET', `/runs/${runId}/export`, { as: OWNER })).json.data
    expect(again.exportedAt).not.toBe(record.exportedAt)
    expect(again.certification.contentSha256).toBe(record.certification.contentSha256)

    const view = await runView(runId)
    const verdict = await h.request('POST', `/runs/${runId}/verdicts`, {
      as: OWNER,
      ifMatch: view.revision,
      body: { outcome: 'selected', selectedConfigurationKey: record.configurations[0].key, rationale: 'Candidate 1 grounded its answers better.', limitations: 'Five cases only.' },
    })
    expect(verdict.status).toBe(201)
    const decided = (await h.request('GET', `/runs/${runId}/export`, { as: OWNER })).json.data
    expect(decided.run.status).toBe('decided')
    expect(decided.verdicts).toMatchObject([{ revision: 1, outcome: 'selected', selectedConfigurationKey: record.configurations[0].key }])
    expect(Object.keys(decided.verdicts[0]).sort()).toEqual(['createdAt', 'limitations', 'outcome', 'rationale', 'revision', 'selectedConfigurationKey'])
    expect(decided.certification.contentSha256).not.toBe(record.certification.contentSha256)

    for (const sentinel of await secrets(token)) expect(first.text, `leaked ${sentinel}`).not.toContain(sentinel)
    const audit = await h.db.prepare(`SELECT actor_user_id, metadata_json FROM audit_events WHERE event_type = 'run.export'`).all<any>()
    expect(audit.results).toHaveLength(3)
    expect(JSON.parse(audit.results[0].metadata_json)).toEqual({ format: 'json', contentSha256: record.certification.contentSha256 })
  })

  it('CSV is one row per rating with formula-neutralized cells and no secrets', async () => {
    const { runId, token } = await reviewingRun()
    await reveal(runId)
    const res = await h.request('GET', `/runs/${runId}/export?format=csv`, { as: OWNER })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="model-court-record-${runId}.csv"`)
    expect([...res.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM for spreadsheet apps
    const parsed = parseCsv(res.text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const [header, ...rows] = parsed.rows
    expect(header).toEqual([...RECORD_CSV_HEADER])
    expect(rows).toHaveLength(20)
    const col = (name: (typeof RECORD_CSV_HEADER)[number]) => header.indexOf(name)
    // No cell may start with a formula trigger.
    for (const row of rows) for (const cell of row) expect(/^[=+\-@\t\r]/.test(cell), `unsafe cell ${JSON.stringify(cell)}`).toBe(false)
    expect(rows.filter((row) => row[col('case_number')] === '1').every((row) => row[col('case_title')] === `'${FORMULA_TITLE}`)).toBe(true)
    const jurorRows = rows.filter((row) => row[col('juror')] === 'Juror 1')
    expect(jurorRows).toHaveLength(10)
    expect(jurorRows.every((row) => row[col('note')] === `'${FORMULA_NOTE}` && row[col('correctness')] === '2')).toBe(true)
    expect(rows.filter((row) => row[col('juror')] === 'Judge (context-aware)').every((row) => row[col('juror_context')] === 'owner')).toBe(true)
    const run = await h.db.prepare('SELECT snapshot_hash FROM runs WHERE id = ?').bind(runId).first<{ snapshot_hash: string }>()
    expect(rows.every((row) => row[col('snapshot_hash')] === run!.snapshot_hash && row[col('rubric_version')] === 'reference-qa-v1')).toBe(true)
    for (const sentinel of await secrets(token)) expect(res.text, `leaked ${sentinel}`).not.toContain(sentinel)
  })

  it('CSV keeps unrated responses from excluded cases as rows without juror columns', async () => {
    const setup = await setupOwner(h)
    let failOpenAi = 2 // case 1's OpenAI generation fails on both attempts → excluded
    h.setProvider(async (call) => {
      if (call.url.includes('openai') && JSON.stringify(call.body).includes('12 days ago') && failOpenAi-- > 0) return new Response('{}', { status: 500 })
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    const runId = (
      await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
        as: OWNER,
        body: { draftRevision: 1, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
      })
    ).json.data.runId as string
    await h.drainJobs()
    let view = await runView(runId)
    const failed = view.generations.find((g: any) => g.status === 'failed')
    await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: [failed.id], acknowledgePossiblePriorCharge: true } })
    await h.drainJobs()
    view = await runView(runId)
    await openDeliberation(h, runId)
    await submit(runId, OWNER, 2)
    await reveal(runId)
    const parsed = parseCsv((await h.request('GET', `/runs/${runId}/export?format=csv`, { as: OWNER })).text)
    if (!parsed.ok) throw new Error(parsed.error)
    const [header, ...rows] = parsed.rows
    const excluded = rows.filter((row) => row[header.indexOf('case_eligible')] === 'false')
    expect(excluded).toHaveLength(2) // one per configuration
    expect(excluded.every((row) => row[header.indexOf('juror')] === '' && row[header.indexOf('correctness')] === '')).toBe(true)
    expect(excluded.map((row) => row[header.indexOf('response_status')]).sort()).toEqual(['failed', 'succeeded'])
    expect(rows).toHaveLength(2 + 4 * 2)
  })
})
