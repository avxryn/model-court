/**
 * Spec 03 (D-76): automatic checks through storage, sealing, results and export, on both stores.
 * Steps 2–4 use a test-only kit (general-v1 with one trivial check, injected through `deps.kits`)
 * and the two published kits. No provider call is real: `providerFetch` is a stub.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCsv } from '../../src/domain/csv'
import { GENERAL_V1 } from '../../src/domain/kits/general'
import { KITS, type KitTable } from '../../src/domain/kits/registry'
import { countWordsV1 } from '../../src/domain/kits/text'
import type { TaskKit } from '../../src/domain/kits/types'
import { RECORD_CSV_HEADER } from '../../src/server/services/export'
import { runMaintenance } from '../../src/server/services/maintenance'
import { exportSnapshot, openSnapshot, restoreSnapshot, sealSnapshot } from '../../src/server/services/backup'
import { dispatchOutbox } from '../../src/server/services/generation'
import { anthropicOk, createHarness, openAiOk, openDeliberation, OWNER, randomKeyB64, REVIEWER, setupOwner, startRun, type Harness } from './harness'

const SHORT_REASON = 'Short enough: NUMBER words.'
const LONG_REASON = 'Too long: NUMBER words.'

/** general-v1 plus one trivial check: an answer of at most 10 words passes. OpenAI's stub answer has 9, Anthropic's 11 (a dash is not a word). */
const TEST_KIT: TaskKit<undefined, undefined> = {
  ...GENERAL_V1,
  checks: [
    {
      id: 'short',
      label: 'Short answer',
      description: 'At most ten words.',
      run: ({ testimony }) => {
        const words = countWordsV1(testimony.text)
        return words <= 10 ? { status: 'pass', reason: SHORT_REASON.replace('NUMBER', String(words)), detail: { words } } : { status: 'fail', reason: LONG_REASON.replace('NUMBER', String(words)), detail: { words } }
      },
    },
  ],
}
const TEST_KITS: KitTable = { ...KITS, 'general-v1': TEST_KIT }

const THROWING_KITS: KitTable = {
  ...KITS,
  'general-v1': {
    ...GENERAL_V1,
    checks: [
      { id: 'boom', label: 'Boom', description: 'Always throws.', run: () => { throw new Error('THROWN-WITH-SECRET-TEXT') } },
      TEST_KIT.checks[0],
    ],
  },
}

let h: Harness
afterEach(async () => {
  await h.dispose()
})

async function countRows(harness: Harness = h): Promise<number> {
  return Number((await harness.db.prepare('SELECT COUNT(*) AS n FROM testimony_checks').first<{ n: number }>())?.n ?? 0)
}

async function runView(runId: string, as = OWNER) {
  return (await h.request('GET', `/runs/${runId}`, { as })).json.data
}

async function submit(runId: string, user: string, score: 0 | 1 | 2, request: Harness['request'] = h.request, auth: { as?: string; headers?: Record<string, string> } = { as: user }) {
  const review = (await request('GET', `/runs/${runId}/review`, auth)).json.data
  const ratings = review.cases.flatMap((c: any) =>
    c.responses.map((r: any) => ({ responseId: r.responseId, correctness: score, completeness: score, grounding: score, note: score === 0 ? 'Contradicts the reference policy.' : '', suspectedIdentityClue: false })),
  )
  const saved = await request('PUT', `/runs/${runId}/review`, { ...auth, ifMatch: review.sessionRevision, body: { ratings } })
  expect(saved.status).toBe(200)
  expect((await request('POST', `/runs/${runId}/review/submit`, { ...auth, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
}

async function invite(runId: string): Promise<string> {
  const res = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  expect(res.status).toBe(201)
  return new URL(res.json.data.url).hash.replace('#token=', '')
}

async function reveal(runId: string) {
  const view = await runView(runId)
  const res = await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: view.review?.pendingCount ?? 0 } })
  expect(res.status).toBe(200)
}

/** Generated, deliberating, with one signed-in juror who has filed. */
async function deliberatingHearing() {
  const setup = await setupOwner(h)
  const runId = (await startRun(h, setup)).json.data.runId as string
  await h.drainJobs()
  await openDeliberation(h, runId)
  expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })).status).toBe(200)
  await submit(runId, REVIEWER, 2)
  return { setup, runId }
}

async function results(runId: string) {
  const res = await h.request('GET', `/runs/${runId}/results`, { as: OWNER })
  expect(res.status).toBe(200)
  return res.json.data
}

function keyNames(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keyNames(item, out)
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      out.add(key)
      keyNames(entry, out)
    }
  }
  return out
}

describe('default hearings are unchanged (spec 03 test 1)', () => {
  beforeEach(async () => {
    h = await createHarness()
  })

  it('stores no check rows, reports kit and checks as null, and exports without kit keys', async () => {
    const { runId } = await deliberatingHearing()
    await submit(runId, OWNER, 1)
    expect(await countRows()).toBe(0)
    const snapshot = await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(runId).first<{ snapshot_json: string }>()
    expect(JSON.parse(snapshot!.snapshot_json)).not.toHaveProperty('kit')
    await reveal(runId)
    const data = await results(runId)
    expect(data.kit).toBeNull()
    expect(data.checks).toBeNull()
    expect(keyNames(data.cases).has('kitFields')).toBe(false)
    expect(keyNames(data.cases).has('checks')).toBe(false)
    const json = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    for (const key of ['kit', 'kitVersion', 'checks', 'kitFields']) expect(keyNames(json).has(key), key).toBe(false)
    expect(json.certification.statement).not.toContain('Automatic checks')
    const csv = (await h.request('GET', `/runs/${runId}/export?format=csv`, { as: OWNER })).text
    const parsed = parseCsv(csv)
    expect(parsed.ok && parsed.rows[0]).toEqual([...RECORD_CSV_HEADER])
  })
})

describe('automatic checks with a test kit', () => {
  beforeEach(async () => {
    h = await createHarness({ kits: TEST_KITS })
  })

  it('commits one row per accepted testimony in the generation batch (spec 03 test 2, pipeline)', async () => {
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId as string
    await h.drainJobs()
    const rows = (
      await h.db
        .prepare(
          `SELECT t.case_key, t.configuration_key, t.attempt_id, t.imported_output_id, t.kit_version, t.results_json, g.provider
           FROM testimony_checks t JOIN generation_attempts a ON a.id = t.attempt_id JOIN generations g ON g.id = a.generation_id WHERE t.run_id = ?`,
        )
        .bind(runId)
        .all<any>()
    ).results
    expect(rows).toHaveLength(10)
    for (const row of rows) {
      expect(row.kit_version).toBe('general-v1')
      expect(row.imported_output_id).toBeNull()
      const [result] = JSON.parse(row.results_json)
      expect(result).toEqual(
        row.provider === 'openai'
          ? { checkId: 'short', status: 'pass', reason: 'Short enough: 9 words.', detail: { words: 9 } }
          : { checkId: 'short', status: 'fail', reason: 'Too long: 11 words.', detail: { words: 11 } },
      )
    }
  })

  it('keeps every check fact sealed from every role and route until unsealing (spec 03 test 4)', async () => {
    const { setup, runId } = await deliberatingHearing()
    expect(await countRows()).toBe(10)
    const token = await invite(runId)
    const join = await h.request('POST', '/invites/redeem-as-guest', { headers: { Origin: 'https://model-court.test' }, body: { token, displayName: 'Dana' } })
    expect(join.status).toBe(201)
    const guest = { headers: { Cookie: (join.headers.get('Set-Cookie') ?? '').split(';')[0] } }

    const bodies: unknown[] = [
      (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json,
      (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json,
      (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json,
      (await h.request('GET', `/evaluations`, { as: OWNER })).json,
      (await h.request('GET', `/runs/${runId}`, { as: REVIEWER })).json,
      (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json,
      (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: REVIEWER })).json,
      (await h.request('GET', `/runs/${runId}`, guest)).json,
      (await h.request('GET', `/runs/${runId}/review`, guest)).json,
      h.notices,
      h.logs,
    ]
    for (const body of bodies) {
      const text = JSON.stringify(body)
      expect(text).not.toContain('Short enough')
      expect(text).not.toContain('Too long')
      expect(keyNames(body).has('checks')).toBe(false)
      expect(keyNames(body).has('checkId')).toBe(false)
    }
    for (const auth of [{ as: OWNER }, { as: REVIEWER }, guest]) expect((await h.request('GET', `/runs/${runId}/results`, auth)).status).toBe(409)
    expect((await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).status).toBe(409)
  })

  it('reports checks next to the findings after unsealing and never mixes them in (spec 03 test 5)', async () => {
    const { runId } = await deliberatingHearing()
    await submit(runId, OWNER, 1)
    await reveal(runId)
    const data = await results(runId)
    expect(data.kit).toBeNull()
    const [openai, anthropic] = data.configurations.map((c: any) => c.key)
    expect(data.checks.kitVersion).toBe('general-v1')
    expect(data.checks.definitions).toEqual([{ id: 'short', label: 'Short answer', description: 'At most ten words.' }])
    expect(data.checks.byConfiguration[openai].short).toEqual({ pass: 5, fail: 0, na: 0, error: 0 })
    expect(data.checks.byConfiguration[anthropic].short).toEqual({ pass: 0, fail: 5, na: 0, error: 0 })
    expect(data.checks.allPassed).toEqual({ [openai]: { numerator: 5, denominator: 5 }, [anthropic]: { numerator: 0, denominator: 5 } })
    expect(data.checks.allPassedSamples).toBeNull()
    for (const testCase of data.cases) {
      expect(testCase.kitFields).toBeNull()
      for (const response of testCase.responses) expect(response.checks).toHaveLength(1)
    }

    await h.db.prepare('DELETE FROM testimony_checks WHERE run_id = ?').bind(runId).run()
    const without = await results(runId)
    for (const key of ['cohorts', 'disagreements', 'byLanguage', 'coverage', 'setupMetrics']) expect(JSON.stringify(without[key]), key).toBe(JSON.stringify(data[key]))
  })

  it('a cancel between claim and commit leaves neither testimony nor check row (spec 03 test 6)', async () => {
    const setup = await setupOwner(h)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    h.setProvider(async (call) => {
      await gate
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    const runId = (await startRun(h, setup)).json.data.runId as string
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    const pending = handleGenerationJob(h.deps, h.jobs.shift()!, new AbortController().signal, 'req')
    while (h.providerCalls.length === 0) await new Promise((r) => setTimeout(r, 10))
    const view = await runView(runId)
    expect((await h.request('POST', `/runs/${runId}/cancel`, { as: OWNER, ifMatch: view.revision, body: {} })).status).toBe(200)
    release()
    expect(await pending).toBe('stale')
    expect(await countRows()).toBe(0)
  })

  it('a completion after key revocation writes no check row (spec 03 test 6)', async () => {
    const setup = await setupOwner(h)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    h.setProvider(async (call) => {
      await gate
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    await startRun(h, setup)
    const job = h.jobs.shift()!
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    const pending = handleGenerationJob(h.deps, job, new AbortController().signal, 'req')
    while (h.providerCalls.length === 0) await new Promise((r) => setTimeout(r, 10))
    const provider = (await h.db.prepare('SELECT provider FROM generations WHERE id = ?').bind(job.generationId).first<any>()).provider
    await h.request('DELETE', `/credentials/${provider === 'openai' ? setup.openaiKeyId : setup.anthropicKeyId}`, { as: OWNER, ifMatch: 1 })
    release()
    expect(await pending).toBe('stale')
    expect(await countRows()).toBe(0)
  })

  it('check rows are append-only (spec 03 test 8)', async () => {
    const setup = await setupOwner(h)
    await startRun(h, setup)
    await h.drainJobs()
    await expect(h.db.prepare(`UPDATE testimony_checks SET results_json = '[]'`).run()).rejects.toThrow(/IMMUTABLE_TESTIMONY_CHECKS/)
  })

  it('exports kit fields, checks and the appended CSV columns, with a stable fingerprint (spec 03 test 11)', async () => {
    const { runId } = await deliberatingHearing()
    await reveal(runId)
    const first = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    h.advance(60_000)
    const second = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    expect(second.certification.contentSha256).toBe(first.certification.contentSha256)
    expect(first.versions.kitVersion).toBe('general-v1')
    expect(first).not.toHaveProperty('kit')
    expect(first.checks.definitions[0].id).toBe('short')
    expect(first.responses.every((r: any) => Array.isArray(r.checks) && r.checks.length === 1)).toBe(true)
    expect(first.certification.statement).toContain('Automatic checks (general-v1) are reported separately and are not part of the ratings.')

    const csv = (await h.request('GET', `/runs/${runId}/export?format=csv`, { as: OWNER })).text
    const parsed = parseCsv(csv)
    if (!parsed.ok) throw new Error(parsed.error)
    const [header, ...rows] = parsed.rows
    expect(header).toEqual([...RECORD_CSV_HEADER, 'kit_version', 'checks_passed', 'checks_failed', 'checks_not_applicable', 'checks_failed_ids'])
    const tail = (row: string[]) => row.slice(RECORD_CSV_HEADER.length)
    expect(rows.map(tail)).toContainEqual(['general-v1', '1', '0', '0', ''])
    expect(rows.map(tail)).toContainEqual(['general-v1', '0', '1', '0', 'short'])
  })

  it('backs up and restores check rows, and purging a case removes them (spec 03 test 10)', async () => {
    const setup = await setupOwner(h)
    await startRun(h, setup)
    await h.drainJobs()
    expect(await countRows()).toBe(10)

    const target = await createHarness()
    try {
      const key = Uint8Array.from(Buffer.from(randomKeyB64(), 'base64'))
      const snapshot = await openSnapshot(key, await sealSnapshot(key, await exportSnapshot(h.deps)))
      expect(snapshot.tables.testimony_checks).toHaveLength(10)
      await restoreSnapshot(target.deps, snapshot)
      expect(await countRows(target)).toBe(10)
    } finally {
      await target.dispose()
    }

    const evaluation = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    expect((await h.request('DELETE', `/evaluations/${setup.evaluationId}`, { as: OWNER, ifMatch: evaluation.revision, body: { confirmTitle: evaluation.title } })).status).toBe(202)
    h.advance(121_000)
    expect((await runMaintenance(h.deps)).evaluationsPurged).toBe(1)
    expect(await countRows()).toBe(0)
  })
})

describe('a check that throws (spec 03 test 7)', () => {
  beforeEach(async () => {
    h = await createHarness({ kits: THROWING_KITS })
  })

  it('commits the testimony, stores an error result, and logs no text', async () => {
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId as string
    await h.drainJobs()
    expect((await runView(runId)).counts.succeeded).toBe(10)
    const rows = (await h.db.prepare('SELECT results_json FROM testimony_checks').all<{ results_json: string }>()).results
    expect(rows).toHaveLength(10)
    for (const row of rows) {
      const [boom, short] = JSON.parse(row.results_json)
      expect(boom).toEqual({ checkId: 'boom', status: 'error', reason: 'This check could not run. That is a fault in Model Court, not in the answer.', detail: {} })
      expect(short.checkId).toBe('short')
    }
    const errors = h.logs.filter((log) => log.event === 'checks.error')
    expect(errors).toHaveLength(10)
    expect(errors[0]).toEqual({ event: 'checks.error', kitVersion: 'general-v1', checkId: 'boom' })
    expect(JSON.stringify(h.logs)).not.toContain('THROWN-WITH-SECRET-TEXT')
  })
})

// ---------------------------------------------------------------------------
// summarization-v1 (spec 03 step 3, D-77)
// ---------------------------------------------------------------------------

const SUMMARY_SETTINGS = { lengthUnit: 'words', maxLength: 12, format: 'bullets', checkNumbers: true }
const SUMMARY_FIELDS = { kind: 'summarization', requiredPoints: [{ text: 'Return window', anyOf: ['30 days'] }], mustNotMention: ['Whitfield'] }
const OPENAI_SUMMARY = '- Returns within 30 days with a receipt.\n- Final-sale items excluded.'
const ANTHROPIC_SUMMARY = 'Returns accepted for 45 days.'

async function summarizationCase(harness: Harness) {
  const setup = await setupOwner(harness)
  const { schemaVersion: _v, ...draft } = setup.draft
  const body = { ...draft, kit: { version: 'summarization-v1', settings: SUMMARY_SETTINGS }, cases: draft.cases.map((c: any) => ({ ...c, kitFields: SUMMARY_FIELDS })) }
  const saved = await harness.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body })
  expect(saved.status).toBe(200)
  return setup
}

async function startAt(harness: Harness, setup: Awaited<ReturnType<typeof setupOwner>>, draftRevision: number) {
  return harness.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

describe('a summarization hearing (spec 03 test 2)', () => {
  beforeEach(async () => {
    h = await createHarness()
  })

  it('keeps the kit and question fields on the stored draft, and refuses mismatched fields', async () => {
    const setup = await summarizationCase(h)
    const evaluation = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    expect(evaluation.draft.kit).toEqual({ version: 'summarization-v1', settings: SUMMARY_SETTINGS })
    expect(evaluation.draft.cases.every((c: any) => JSON.stringify(c.kitFields) === JSON.stringify(SUMMARY_FIELDS))).toBe(true)
    const { schemaVersion: _v, kit: _kit, ...general } = evaluation.draft
    const refused = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: evaluation.revision, body: general })
    expect(refused.status).toBe(422)
    expect(JSON.stringify(refused.json)).toContain('kitFields')
    const wrongKind = { ...general, kit: evaluation.draft.kit, cases: general.cases.map((c: any) => ({ ...c, kitFields: { kind: 'classification' } })) }
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: evaluation.revision, body: wrongKind })).status).toBe(422)
  })

  it('checks every accepted summary in its own batch, and a retried attempt 2 has its own row and is the one shown', async () => {
    const setup = await summarizationCase(h)
    let failOnce = true
    h.setProvider(async (call) => {
      if (call.url.includes('openai')) {
        if (failOnce) {
          failOnce = false
          return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 })
        }
        return openAiOk(OPENAI_SUMMARY)
      }
      return anthropicOk(ANTHROPIC_SUMMARY)
    })
    const started = await startAt(h, setup, 2)
    expect(started.status).toBe(202)
    const runId = started.json.data.runId as string
    await h.drainJobs()
    // The paid request carries the template and limits, never the answer keys.
    const sent = JSON.stringify(h.providerCalls.map((call) => call.body))
    expect(sent).toContain('limits')
    expect(sent).toContain('"document')
    for (const secret of ['Return window', 'Whitfield', 'Explain the stated eligibility']) expect(sent).not.toContain(secret)
    expect(await countRows()).toBe(9)
    let view = await runView(runId)
    const failed = view.generations.find((g: any) => g.status === 'failed')
    expect((await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: [failed.id], acknowledgePossiblePriorCharge: true } })).status).toBe(202)
    await h.drainJobs()
    expect(await countRows()).toBe(10)
    const attempt2 = await h.db
      .prepare('SELECT t.kit_version, a.attempt_no FROM testimony_checks t JOIN generation_attempts a ON a.id = t.attempt_id WHERE a.generation_id = ?')
      .bind(failed.id)
      .all<any>()
    expect(attempt2.results).toEqual([{ kit_version: 'summarization-v1', attempt_no: 2 }])

    view = await runView(runId)
    await openDeliberation(h, runId)
    await submit(runId, OWNER, 1)
    await reveal(runId)
    const data = await results(runId)
    expect(data.kit).toEqual({ version: 'summarization-v1', name: 'Summaries', settings: SUMMARY_SETTINGS })
    expect(data.rubricVersion).toBe('summary-v1')
    expect(data.messageTemplateVersion).toBe('summarize-v1')
    const [openai, anthropic] = data.configurations.map((c: any) => c.key)
    const failedCase = data.cases.find((c: any) => c.key === failed.caseKey)
    const shown = failedCase.responses.find((r: any) => r.configurationKey === openai)
    expect(shown.attemptCount).toBe(2)
    expect(shown.checks.map((c: any) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass'])
    const other = failedCase.responses.find((r: any) => r.configurationKey === anthropic)
    expect(Object.fromEntries(other.checks.map((c: any) => [c.checkId, c.reason]))).toEqual({
      length: '5 words; the limit is 12.',
      format: 'Line 1 is not a bullet point.',
      'required-points': 'Missing 1 of 1: (1) Return window.',
      'must-not-mention': 'None of the 1 listed phrase appears.',
      'numbers-from-document': 'Not in the document: 45 (may be computed or reworded).',
    })
    expect(failedCase.kitFields).toEqual(SUMMARY_FIELDS)
    expect(data.checks.byConfiguration[openai].format).toEqual({ pass: 5, fail: 0, na: 0, error: 0 })
    expect(data.checks.byConfiguration[anthropic]['numbers-from-document']).toEqual({ pass: 1, fail: 4, na: 0, error: 0 }) // Q2's request itself says 45 days
    expect(data.checks.allPassed).toEqual({ [openai]: { numerator: 5, denominator: 5 }, [anthropic]: { numerator: 0, denominator: 5 } })
    expect(data.checks.metrics).toEqual([{ id: 'median-length', label: 'Median length', byConfiguration: { [openai]: null, [anthropic]: null }, values: { [openai]: 10, [anthropic]: 5 }, unit: 'words', caveat: null }])

    const record = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    expect(record.versions.kitVersion).toBe('summarization-v1')
    expect(record.kit.name).toBe('Summaries')
    expect(record.cases[0].kitFields).toEqual(SUMMARY_FIELDS)
  })

  it('refuses to start a summarization question without a document', async () => {
    const setup = await summarizationCase(h)
    const evaluation = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    const { schemaVersion: _v, ...draft } = evaluation.draft
    const body = { ...draft, cases: draft.cases.map((c: any, i: number) => (i === 1 ? { ...c, reference: '' } : c)) }
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: evaluation.revision, body })).status).toBe(200)
    const refused = await startAt(h, setup, evaluation.revision + 1)
    expect(refused.status).toBe(422)
    expect(refused.json.error.code).toBe('UNSUPPORTED_CONFIGURATION')
    expect(refused.json.error.details.issues).toEqual([{ kind: 'kit_document_missing', caseKey: draft.cases[1].key, kitVersion: 'summarization-v1' }])
    expect(h.providerCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// classification-v1 (spec 03 step 4, D-78)
// ---------------------------------------------------------------------------

const CLASSIFY_SETTINGS = { labels: ['Billing', 'Bug', 'Other'], minReasoningWords: 3 }
/** Expected labels per question; Q5 has no answer key. */
const EXPECTED = ['Billing', 'Bug', 'Billing', 'Other', null]
const IMPORTED_ANSWERS = ['Label: Billing\nA charge on the card.', 'Label: Billing\nIt is about money.', 'Probably billing', 'Label: Other\nNot covered anywhere.', 'Label: Bug\nThe app fails.']

async function classificationCase(harness: Harness, opts: { imported?: boolean; samplesPerAnswer?: 2 | 3 } = {}) {
  const setup = await setupOwner(harness)
  const { schemaVersion: _v, ...draft } = setup.draft
  const imported = { kind: 'imported', key: crypto.randomUUID(), label: 'Help desk export', provenance: { sourceType: 'transcript_export', description: 'Routed by the help desk', redacted: false } }
  const configurations = opts.imported ? [draft.configurations[0], imported] : draft.configurations
  const body = {
    ...draft,
    comparisonMode: opts.imported ? 'configuration' : draft.comparisonMode,
    configurations,
    kit: { version: 'classification-v1', settings: CLASSIFY_SETTINGS },
    cases: draft.cases.map((c: any, i: number) => ({ ...c, kitFields: EXPECTED[i] ? { kind: 'classification', expectedLabel: EXPECTED[i] } : { kind: 'classification' } })),
    ...(opts.samplesPerAnswer ? { samplesPerAnswer: opts.samplesPerAnswer } : {}),
  }
  const saved = await harness.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body })
  expect(saved.status).toBe(200)
  let revision = saved.json.data.revision as number
  if (opts.imported) {
    const items = draft.cases.map((c: any, i: number) => ({ caseKey: c.key, text: IMPORTED_ANSWERS[i] }))
    const put = await harness.request('PUT', `/evaluations/${setup.evaluationId}/imports/${imported.key}`, { as: OWNER, ifMatch: revision, body: { items, confirmMayShareWithJurors: true } })
    expect(put.status).toBe(200)
    revision = put.json.data.revision
  }
  return { setup, draft: body, revision, imported }
}

describe('a classification hearing (spec 03 tests 3 and 9)', () => {
  beforeEach(async () => {
    h = await createHarness()
  })

  it('checks imported answers at admission and reports accuracy per party after unsealing', async () => {
    const { setup, revision, imported } = await classificationCase(h, { imported: true })
    h.setProvider(async () => openAiOk('Label: Billing\nCharge related, see the ticket.'))
    const started = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
      as: OWNER,
      body: { draftRevision: revision, credentialIdsByProvider: { openai: setup.openaiKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(started.status).toBe(202)
    const runId = started.json.data.runId as string
    // The imported party's five rows are written by the admission batch, before any generation.
    const importedRows = await h.db.prepare('SELECT COUNT(*) AS n FROM testimony_checks WHERE imported_output_id IS NOT NULL AND run_id = ?').bind(runId).first<{ n: number }>()
    expect(Number(importedRows?.n)).toBe(5)
    await h.drainJobs()
    const sent = JSON.stringify(h.providerCalls.map((call) => call.body))
    expect(sent).toContain('Label: ')
    expect(sent).not.toContain('expectedLabel')
    expect(await countRows()).toBe(10)

    await openDeliberation(h, runId)
    // The worksheet carries the kit facts for every party alike, and no check fact (D-79).
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    expect(review.kit).toEqual({ version: 'classification-v1', name: 'Classification' })
    expect(review.cases.map((c: any) => c.kitView.expectedLabel)).toEqual(EXPECTED)
    expect(review.cases[0].kitView.labels).toEqual(CLASSIFY_SETTINGS.labels)
    expect(JSON.stringify(review)).not.toMatch(/label-format|names no allowed label|predicted/)
    expect((await runView(runId)).kit).toEqual({ version: 'classification-v1', name: 'Classification' })
    await submit(runId, OWNER, 1)
    await reveal(runId)
    const data = await results(runId)
    expect(data.kit).toEqual({ version: 'classification-v1', name: 'Classification', settings: CLASSIFY_SETTINGS })
    expect(data.rubricVersion).toBe('classification-v1')
    expect(data.messageTemplateVersion).toBe('classify-v1')
    const model = data.configurations[0].key
    const accuracy = data.checks.metrics.find((m: any) => m.id === 'accuracy')
    // The model always says Billing: right on Q1 and Q3 of the four keyed questions.
    expect(accuracy.byConfiguration[model]).toEqual({ numerator: 2, denominator: 4 })
    // Imported: Q1 right, Q2 wrong, Q3 no allowed label, Q4 right.
    expect(accuracy.byConfiguration[imported.key]).toEqual({ numerator: 2, denominator: 4 })
    expect(accuracy.caveat).toBe('On 4 questions; one question moves this by 25 percentage points. A small sample, not a benchmark.')
    expect(data.checks.metrics.find((m: any) => m.id === 'invalid-labels').byConfiguration[imported.key]).toEqual({ numerator: 1, denominator: 5 })
    const q3 = data.cases[2].responses.find((r: any) => r.configurationKey === imported.key)
    expect(q3.status).toBe('imported')
    expect(q3.checks.find((c: any) => c.checkId === 'label-format')).toMatchObject({ status: 'fail', reason: "The first line, 'Probably billing', names no allowed label." })
    expect(data.cases[4].kitFields).toEqual({ kind: 'classification' })
    expect(data.cases[4].responses[0].checks.find((c: any) => c.checkId === 'label-correct').status).toBe('na')

    const csv = (await h.request('GET', `/runs/${runId}/export?format=csv`, { as: OWNER })).text
    const parsed = parseCsv(csv)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.rows[0].slice(-5)).toEqual(['kit_version', 'checks_passed', 'checks_failed', 'checks_not_applicable', 'checks_failed_ids'])
    expect(parsed.rows.slice(1).some((row) => row.at(-1) === 'label-format;label-correct;reasoning-given')).toBe(true)
  })

  it('reports label agreement across samples with repeats (spec 01 §10)', async () => {
    const { setup, revision } = await classificationCase(h, { samplesPerAnswer: 2 })
    let call = 0
    h.setProvider(async (request) => (request.url.includes('openai') ? openAiOk(`Label: ${++call % 2 ? 'Billing' : 'Bug'}\nBecause of the ticket.`) : anthropicOk('Label: Other\nNot covered here.')))
    const runId = (await startAt(h, setup, revision)).json.data.runId as string
    await h.drainJobs()
    h.advance(60_000)
    await dispatchOutbox(h.deps)
    await h.drainJobs()
    expect(await countRows()).toBe(20)
    await openDeliberation(h, runId)
    await submit(runId, OWNER, 1)
    await reveal(runId)
    const data = await results(runId)
    const [openai, anthropic] = data.configurations.map((c: any) => c.key)
    expect(data.setupMetrics[anthropic].consistency.byKit).toEqual({ agreement: 1, key: 'label' })
    expect(data.setupMetrics[openai].consistency.byKit.agreement).toBeLessThan(1)
    expect(data.checks.allPassedSamples[anthropic]).toEqual({ numerator: 4, denominator: 10 })
    expect(data.cases[0].responses[0].samples.every((s: any) => Array.isArray(s.checks))).toBe(true)
  })

  it('refuses mismatched answer keys (422) and a classification question with a conversation at Start', async () => {
    const { setup, draft, revision } = await classificationCase(h)
    const bad = { ...draft, cases: draft.cases.map((c: any) => ({ ...c, kitFields: { kind: 'classification', expectedLabel: 'Refunds' } })) }
    const refused = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: revision, body: bad })
    expect(refused.status).toBe(422)
    expect(refused.json.error.code).toBe('VALIDATION_FAILED')
    expect(JSON.stringify(refused.json.error)).toContain('expectedLabel')
    const history = [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier reply' },
    ]
    const withHistory = { ...draft, cases: draft.cases.map((c: any, i: number) => (i === 0 ? { ...c, messages: history } : c)) }
    const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: revision, body: withHistory })
    expect(saved.status).toBe(200)
    const start = await startAt(h, setup, saved.json.data.revision)
    expect(start.status).toBe(422)
    expect(start.json.error.details.issues).toEqual([{ kind: 'kit_input_unsupported', caseKey: draft.cases[0].key, inputKind: 'conversation', kitVersion: 'classification-v1' }])
    expect(start.json.error.message).toContain("Classification questions can't carry a conversation yet")
    expect(h.providerCalls).toHaveLength(0)
  })
})
