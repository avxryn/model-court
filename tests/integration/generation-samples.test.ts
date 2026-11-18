/**
 * Repeats (D-65): migration 0009_generation_samples as a real 0008 → 0009 transition on a seeded
 * store, and the sample pipeline end to end. Runs on both stores (local D1 and the ModelCourtStore
 * Durable Object SQLite).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { BACKUP_TABLES, exportSnapshot, restoreSnapshot } from '../../src/server/services/backup'
import { dispatchOutbox } from '../../src/server/services/generation'
import { anthropicOk, createHarness, openAiOk, openPreSamplesDatabase, OWNER, REVIEWER, setupOwner, type Harness } from './harness'

const CHILDREN = ['generation_attempts', 'outbox', 'attempt_reservations'] as const
const TABLES = ['generations', ...CHILDREN] as const

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

type Db = D1Database
const rows = async (db: Db, sql: string, ...params: Array<string | number>) => (await db.prepare(sql).bind(...params).all<Record<string, unknown>>()).results

/** Two runs with generations in every state; attempts, outbox rows and reservations in every state. */
async function seedLegacy(db: Db) {
  const t = 1_763_000_000_000
  const statements: D1PreparedStatement[] = []
  const add = (sql: string, ...params: Array<string | number | null>) => statements.push(db.prepare(sql).bind(...params))
  add(`INSERT INTO evaluations (id, owner_user_id, title, task_description, draft_json, revision, created_at, updated_at) VALUES ('ev1', 'u1', 'Seeded', '', '{}', 1, ?, ?)`, t, t)
  for (const run of ['run1', 'run2']) {
    add(`INSERT INTO runs (id, evaluation_id, owner_user_id, status, snapshot_json, snapshot_hash, revision, created_at, updated_at) VALUES (?, 'ev1', 'u1', ?, '{}', 'hash', 1, ?, ?)`, run, run === 'run1' ? 'generating' : 'canceled', t, t)
  }
  const states = ['pending', 'running', 'succeeded', 'failed', 'uncertain', 'canceled'] as const
  states.forEach((status, i) => {
    const id = `g${i}`
    add(
      `INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, attempt_count, accepted_attempt_id, last_error_code, created_at, updated_at) VALUES (?, 'run1', ?, 'cfgA', 'openai', ?, 1, ?, ?, ?, ?)`,
      id,
      `case${i}`,
      status,
      status === 'succeeded' ? `a${i}` : null,
      status === 'failed' ? 'PROVIDER_RATE_LIMITED' : null,
      t + i,
      t + i,
    )
    const attemptStatus = status === 'pending' ? null : status
    if (attemptStatus) {
      add(
        `INSERT INTO generation_attempts (id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, queue_wait_ms, output_text, input_tokens, output_tokens, duration_ms, error_code, truncated, cached_input_tokens, reasoning_tokens)
         VALUES (?, ?, 1, ?, ?, ?, ?, 5, ?, ?, ?, ?, ?, 0, ?, ?)`,
        `a${i}`,
        id,
        `fence${i}`,
        attemptStatus,
        t,
        t + 120_000,
        status === 'succeeded' ? 'An answer.' : null,
        status === 'succeeded' ? 100 : null,
        status === 'succeeded' ? 20 : null,
        status === 'running' ? null : 900 + i,
        status === 'failed' ? 'PROVIDER_RATE_LIMITED' : null,
        status === 'succeeded' ? 10 : null,
        status === 'succeeded' ? 5 : null,
      )
    }
    const outboxStatus = { pending: 'pending', running: 'claimed', succeeded: 'terminal', failed: 'terminal', uncertain: 'terminal', canceled: 'dispatched' }[status]
    add(`INSERT INTO outbox (id, generation_id, attempt_no, status, job_id, dispatch_count, next_dispatch_at, created_at, updated_at) VALUES (?, ?, 1, ?, ?, 1, ?, ?, ?)`, `o${i}`, id, outboxStatus, `job${i}`, t, t, t)
    const reservation = status === 'pending' ? 'reserved' : status === 'canceled' ? 'released' : 'consumed'
    add(`INSERT INTO attempt_reservations (generation_id, attempt_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at) VALUES (?, 1, 'user:u1', 'global', 'lifetime', ?, ?, ?)`, id, t, reservation, t)
  })
  // The second run: one finished generation, to check that deleting a run still cascades.
  add(`INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, attempt_count, accepted_attempt_id, created_at, updated_at) VALUES ('h1', 'run2', 'case0', 'cfgA', 'anthropic', 'succeeded', 1, 'b1', ?, ?)`, t, t)
  add(`INSERT INTO generation_attempts (id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, output_text, truncated) VALUES ('b1', 'h1', 1, 'fenceB', 'succeeded', ?, ?, 'Other.', 0)`, t, t)
  add(`INSERT INTO outbox (id, generation_id, attempt_no, status, next_dispatch_at, created_at, updated_at) VALUES ('ob1', 'h1', 1, 'terminal', ?, ?, ?)`, t, t, t)
  add(`INSERT INTO attempt_reservations (generation_id, attempt_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at) VALUES ('h1', 1, 'user:u1', 'global', 'lifetime', ?, 'consumed', ?)`, t, t)
  await db.batch(statements)
}

async function tableRows(db: Db) {
  return Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await rows(db, `SELECT * FROM ${table} ORDER BY ${table === 'attempt_reservations' ? 'generation_id, attempt_no' : 'id'}`)] as const)))
}

describe('migration 0009_generation_samples', () => {
  let legacy: Awaited<ReturnType<typeof openPreSamplesDatabase>> | null = null
  afterEach(async () => {
    await legacy?.dispose()
    legacy = null
  })

  it('rebuilds the generation tables without losing or changing a row', async () => {
    legacy = await openPreSamplesDatabase()
    const { db } = legacy
    expect((await rows(db, `SELECT name FROM pragma_table_info('generations') WHERE name = 'sample_no'`)).length).toBe(0)
    await seedLegacy(db)
    const before = await tableRows(db)
    expect(before.generations).toHaveLength(7)
    expect(before.generation_attempts).toHaveLength(6) // the pending generation has no attempt yet

    expect(await legacy.migrateRest()).toEqual(['0009_generation_samples'])
    const after = await tableRows(db)

    // Same rows and values; every existing testimony is sample 1.
    expect(after.generations).toEqual(before.generations.map((row) => ({ ...row, sample_no: 1 })))
    for (const table of CHILDREN) expect(after[table], table).toEqual(before[table])

    // The children now reference the renamed parent, and no scratch table is left behind.
    const schema = await rows(db, `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name IN ('generations','generation_attempts','outbox','attempt_reservations') OR name LIKE '%_next'`)
    expect(schema.filter((object) => String(object.name).endsWith('_next'))).toEqual([])
    for (const table of CHILDREN) {
      const sql = String(schema.find((object) => object.type === 'table' && object.name === table)?.sql)
      expect(sql, table).toMatch(/REFERENCES\s+"?generations"?\s*\(id\)\s+ON DELETE CASCADE/)
      expect(sql, table).not.toContain('generations_next')
    }
    expect(String(schema.find((object) => object.name === 'generations' && object.type === 'table')?.sql)).toContain('UNIQUE (run_id, case_key, configuration_key, sample_no)')
    const names = schema.map((object) => object.name)
    for (const name of [
      'generations_by_run_status',
      'attempts_by_status_deadline',
      'outbox_by_status',
      'generations_accepted_attempt_id_immutable',
      'generation_attempts_output_text_status_finish_reason_immutable',
      'generations_run_id_case_key_configuration_key_sample_no_immutable',
    ]) {
      expect(names, name).toContain(name)
    }

    // No orphan in any child.
    for (const table of CHILDREN) {
      expect(await rows(db, `SELECT c.generation_id FROM ${table} c LEFT JOIN generations g ON g.id = c.generation_id WHERE g.id IS NULL`), table).toEqual([])
    }
    expect(await rows(db, 'SELECT * FROM pragma_foreign_key_check')).toEqual([])

    // The immutability triggers still raise.
    await expect(db.prepare(`UPDATE generation_attempts SET output_text = 'changed' WHERE id = 'a2'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_ATTEMPTS/)
    await expect(db.prepare(`UPDATE generations SET accepted_attempt_id = 'other' WHERE id = 'g2'`).run()).rejects.toThrow(/IMMUTABLE_GENERATIONS/)
    await expect(db.prepare(`UPDATE generations SET sample_no = 2 WHERE id = 'g0'`).run()).rejects.toThrow(/IMMUTABLE_GENERATIONS/)
    await expect(db.prepare(`UPDATE generations SET case_key = 'moved' WHERE id = 'g0'`).run()).rejects.toThrow(/IMMUTABLE_GENERATIONS/)
    expect((await db.prepare(`UPDATE generations SET status = 'failed' WHERE id = 'g1'`).run()).meta.changes).toBe(1)

    // A second sample of the same slot is now allowed; a fourth is not.
    const insert = (id: string, sample: number) =>
      db.prepare(`INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, attempt_count, created_at, updated_at, sample_no) VALUES (?, 'run1', 'case0', 'cfgA', 'openai', 'pending', 1, 0, 0, ?)`).bind(id, sample).run()
    await insert('g0s2', 2)
    await expect(insert('g0s2b', 2)).rejects.toThrow(/UNIQUE/)
    await expect(insert('g0s4', 4)).rejects.toThrow(/CHECK/)

    // Deleting a run still cascades through every child.
    await db.prepare(`DELETE FROM runs WHERE id = 'run2'`).run()
    expect(await rows(db, `SELECT id FROM generations WHERE run_id = 'run2'`)).toEqual([])
    for (const table of CHILDREN) expect(await rows(db, `SELECT generation_id FROM ${table} WHERE generation_id = 'h1'`), table).toEqual([])
    expect((await rows(db, `SELECT id FROM generations WHERE run_id = 'run1'`)).length).toBe(7)
  })

  it('restores a backup taken before the migration into a migrated store', async () => {
    legacy = await openPreSamplesDatabase()
    const h = await createHarness()
    try {
      const setup = await setupOwner(h)
      // Build a real backup on the legacy schema: seed through SQL (the app writes sample_no, which 0008 lacks).
      await seedLegacy(legacy.db)
      const snapshot = await exportSnapshot({ ...h.deps, db: legacy.db })
      expect(snapshot.tables.generations[0]).not.toHaveProperty('sample_no')
      const target = await createHarness()
      try {
        await restoreSnapshot(target.deps, snapshot)
        for (const table of BACKUP_TABLES) {
          const n = (await target.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n
          expect(Number(n), table).toBe(snapshot.tables[table].length + (table === 'audit_events' ? 1 : 0))
        }
        expect(await rows(target.db, 'SELECT DISTINCT sample_no FROM generations')).toEqual([{ sample_no: 1 }])
      } finally {
        await target.dispose()
      }
      void setup
    } finally {
      await h.dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

let h: Harness
afterEach(async () => {
  await h?.dispose()
})

async function runView(runId: string, as = OWNER) {
  return (await h.request('GET', `/runs/${runId}`, { as })).json.data
}

/** Save the seeded draft with repeats (and optional extras), then start it. */
async function startWithSamples(samples: 2 | 3 | undefined, opts: { draftPatch?: (draft: any) => void } = {}) {
  const setup = await setupOwner(h)
  const { schemaVersion: _v, ...draft } = setup.draft
  if (samples) draft.samplesPerAnswer = samples
  opts.draftPatch?.(draft)
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  const started = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: 2, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
  return { setup, started }
}

/** Dispatch and run every staggered sample: one cron minute per extra sample. */
async function drainAllSamples(samples: number) {
  await h.drainJobs()
  for (let k = 2; k <= samples; k++) {
    h.advance(60_000)
    await dispatchOutbox(h.deps)
    await h.drainJobs()
  }
}

async function scoreAndUnseal(runId: string) {
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
  const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: OWNER, ifMatch: review.sessionRevision, body: { ratings } })
  expect((await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
}

const keysDeep = (value: unknown): unknown => (Array.isArray(value) ? value.map(keysDeep) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, keysDeep((value as Record<string, unknown>)[k])])) : typeof value)

describe('repeats: admission', () => {
  it('plans questions × parties × samples, with one reservation and outbox row per sample, staggered a minute apart', async () => {
    h = await createHarness()
    const { started } = await startWithSamples(2)
    expect(started.status).toBe(202)
    expect(started.json.data.plannedCalls).toBe(20)
    const runId = started.json.data.runId
    const generations = await rows(h.db, 'SELECT id, sample_no FROM generations WHERE run_id = ?', runId)
    expect(generations).toHaveLength(20)
    expect(generations.filter((g) => g.sample_no === 2)).toHaveLength(10)
    const reservations = await rows(h.db, `SELECT r.state FROM attempt_reservations r JOIN generations g ON g.id = r.generation_id WHERE g.run_id = ?`, runId)
    expect(reservations).toHaveLength(20)
    const outbox = await rows(h.db, `SELECT o.next_dispatch_at, g.sample_no FROM outbox o JOIN generations g ON g.id = o.generation_id WHERE g.run_id = ?`, runId)
    expect(new Set(outbox.filter((o) => o.sample_no === 1).map((o) => o.next_dispatch_at))).toEqual(new Set([h.now()]))
    expect(new Set(outbox.filter((o) => o.sample_no === 2).map((o) => o.next_dispatch_at))).toEqual(new Set([h.now() + 60_000]))
    // Only sample 1 is dispatched at start; sample 2 waits for the next cron minute.
    expect(h.jobs).toHaveLength(10)
    const view = await runView(runId)
    expect(view.samplesPerAnswer).toBe(2)
    expect(view.counts.planned).toBe(20)
    expect(new Set(view.generations.map((g: any) => g.sampleNo))).toEqual(new Set([1, 2]))
    const audit = await rows(h.db, `SELECT metadata_json FROM audit_events WHERE run_id = ? AND event_type = 'run.create'`, runId)
    expect(JSON.parse(String(audit[0].metadata_json))).toMatchObject({ plannedCalls: 20, samplesPerAnswer: 2 })
  })

  it('refuses a hearing over the daily cap with nothing written', async () => {
    h = await createHarness()
    const { started } = await startWithSamples(3) // 5 × 2 × 3 = 30 > 20 a day per judge
    expect(started.status).toBe(429)
    expect(started.json.error.code).toBe('QUOTA_EXHAUSTED')
    expect(await rows(h.db, 'SELECT id FROM runs')).toEqual([])
    expect(await rows(h.db, 'SELECT id FROM generations')).toEqual([])
    expect(await rows(h.db, 'SELECT generation_id FROM attempt_reservations')).toEqual([])
  })

  it('refuses more samples than MAX_SAMPLES_PER_ANSWER at draft save and at admission', async () => {
    h = await createHarness({ env: { MAX_SAMPLES_PER_ANSWER: '1' } })
    const setup = await setupOwner(h)
    const { schemaVersion: _v, ...draft } = setup.draft
    const refused = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: { ...draft, samplesPerAnswer: 2 } })
    expect(refused.status).toBe(422)
    expect(refused.json.error.fields[0].path).toBe('samplesPerAnswer')
    expect((await h.request('GET', '/catalog', { as: OWNER })).json.data.limits.samplesPerAnswer).toBe(1)

    // Saved while the deployment allowed 3, then lowered to 2 before Start.
    h.env.MAX_SAMPLES_PER_ANSWER = '3'
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: { ...draft, samplesPerAnswer: 3 } })).status).toBe(200)
    h.env.MAX_SAMPLES_PER_ANSWER = '2'
    const start = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
      as: OWNER,
      body: { draftRevision: 2, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(start.status).toBe(422)
    expect(await rows(h.db, 'SELECT id FROM runs')).toEqual([])
  })
})

describe('repeats: pipeline, primary sample and eligibility', () => {
  it('claims every sample independently and opens deliberation only when every sample succeeded', async () => {
    h = await createHarness()
    const { started } = await startWithSamples(2)
    const runId = started.json.data.runId
    await h.drainJobs()
    expect((await runView(runId)).status).toBe('generating') // sample 2 still waits
    h.advance(60_000)
    await dispatchOutbox(h.deps)
    await h.drainJobs()
    const view = await runView(runId)
    expect(view.counts).toMatchObject({ planned: 20, succeeded: 20 })
    expect(view.status).toBe('reviewing')
    const reservations = await rows(h.db, `SELECT r.state FROM attempt_reservations r JOIN generations g ON g.id = r.generation_id WHERE g.run_id = ?`, runId)
    expect(reservations.every((r) => r.state === 'consumed')).toBe(true)
  })

  it('takes the lowest succeeded sample as primary, excludes a question only when every sample failed, and waits for the judge', async () => {
    // 20 planned calls fill the default daily cap; the retry below needs one more.
    h = await createHarness({ env: { MAX_DAILY_CALLS_PER_USER: '100' } })
    // Fail sample 1 of the first OpenAI call and both samples of the second OpenAI question.
    let openaiCalls = 0
    h.setProvider(async (call) => {
      if (!call.url.includes('openai')) return anthropicOk()
      openaiCalls++
      return openaiCalls === 1 || openaiCalls === 2 || openaiCalls === 7 ? new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 }) : openAiOk(`OpenAI answer ${openaiCalls}`)
    })
    const { started } = await startWithSamples(2)
    const runId = started.json.data.runId
    await drainAllSamples(2)
    let view = await runView(runId)
    expect(view.status).toBe('ready') // failures: the judge decides
    const openaiKey = view.configurations.find((c: any) => c.provider === 'openai').key
    const failed = view.generations.filter((g: any) => g.status === 'failed')
    expect(failed).toHaveLength(3)
    const casesWithBothFailed = view.cases.filter((c: any) => failed.filter((g: any) => g.caseKey === c.key).length === 2).map((c: any) => c.key)
    const caseWithOneFailed = view.cases.find((c: any) => failed.filter((g: any) => g.caseKey === c.key).length === 1)?.key
    expect(casesWithBothFailed).toHaveLength(1)
    expect(view.eligibility.excludedCaseKeys).toEqual(casesWithBothFailed)
    expect(view.eligibility.caseKeys).toHaveLength(4)

    // Retrying one sample leaves its sibling untouched.
    const retryTarget = failed.find((g: any) => g.caseKey === casesWithBothFailed[0] && g.sampleNo === 2)
    const sibling = failed.find((g: any) => g.caseKey === casesWithBothFailed[0] && g.sampleNo === 1)
    expect((await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: [retryTarget.id], acknowledgePossiblePriorCharge: true } })).status).toBe(202)
    await h.drainJobs()
    view = await runView(runId)
    expect(view.generations.find((g: any) => g.id === retryTarget.id)).toMatchObject({ status: 'succeeded', attemptCount: 2 })
    expect(view.generations.find((g: any) => g.id === sibling.id)).toMatchObject({ status: 'failed', attemptCount: 1 })
    expect(view.eligibility.excludedCaseKeys).toEqual([])
    expect(view.status).toBe('ready') // one sample still failed, so no automatic opening

    const opened = await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })
    expect(opened.status).toBe(200)
    const manifest = JSON.parse(String((await rows(h.db, 'SELECT eligible_manifest_json FROM runs WHERE id = ?', runId))[0].eligible_manifest_json))
    const entry = (caseKey: string) => manifest.entries.find((e: any) => e.caseKey === caseKey && e.configurationKey === openaiKey)
    expect(entry(caseWithOneFailed!).sampleNo).toBe(2)
    expect(entry(casesWithBothFailed[0]).sampleNo).toBe(2)
    expect(manifest.entries.filter((e: any) => e.sampleNo === undefined).length).toBe(manifest.entries.length - 2)

    // Jurors see exactly one testimony per party per question.
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    expect(review.cases).toHaveLength(5)
    expect(review.cases.every((c: any) => c.responses.length === 2)).toBe(true)

    await scoreAndUnseal(runId)
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.samplesPerAnswer).toBe(2)
    const response = results.cases.find((c: any) => c.key === caseWithOneFailed).responses.find((r: any) => r.configurationKey === openaiKey)
    expect(response.sampleNo).toBe(2)
    expect(response.samples.map((s: any) => ({ sampleNo: s.sampleNo, primary: s.primary, status: s.status }))).toEqual([
      { sampleNo: 1, primary: false, status: 'failed' },
      { sampleNo: 2, primary: true, status: 'succeeded' },
    ])
    expect(response.text).toBe(response.samples[1].text)
    expect(results.coverage[openaiKey]).toMatchObject({ planned: 10, succeeded: 8, failed: 2 })
    expect(results.setupMetrics[openaiKey].calls).toMatchObject({ planned: 10, succeeded: 8, failed: 2, retries: 1 })
    // Consistency (D-66): OpenAI's stub words every answer differently; Anthropic's repeats itself.
    expect(results.setupMetrics[openaiKey].consistency).toMatchObject({ compared: 3, sameAnswer: 0, answeredEveryTime: 3, planned: 5 })
    const anthropicKey = results.configurations.find((c: any) => c.provider === 'anthropic').key
    expect(results.setupMetrics[anthropicKey].consistency).toMatchObject({ compared: 5, sameAnswer: 5, medianOverlap: 1, answeredEveryTime: 5, planned: 5 })
    const exported = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    expect(exported.run.samplesPerAnswer).toBe(2)
    expect(exported.responses.find((r: any) => r.caseKey === caseWithOneFailed && r.configurationKey === openaiKey).samples).toHaveLength(2)
    expect(JSON.stringify(exported)).not.toMatch(/"(generationId|acceptedAttemptId|id)"/)
  })

  it('cancel releases only the samples that were never claimed', async () => {
    h = await createHarness()
    const { started } = await startWithSamples(2)
    const runId = started.json.data.runId
    await h.drainJobs() // sample 1 claimed and finished; sample 2 not yet dispatched
    const view = await runView(runId)
    expect((await h.request('POST', `/runs/${runId}/cancel`, { as: OWNER, ifMatch: view.revision, body: {} })).status).toBe(200)
    const states = await rows(h.db, `SELECT g.sample_no, r.state FROM attempt_reservations r JOIN generations g ON g.id = r.generation_id WHERE g.run_id = ?`, runId)
    expect(states.filter((s) => s.sample_no === 1).every((s) => s.state === 'consumed')).toBe(true)
    expect(states.filter((s) => s.sample_no === 2).every((s) => s.state === 'released')).toBe(true)
  })

  it('applies lease expiry per sample', async () => {
    h = await createHarness()
    const { started } = await startWithSamples(2)
    const runId = started.json.data.runId
    h.setProvider(() => new Promise(() => {}))
    // Claim one sample-1 job and abandon it mid-call.
    const job = h.jobs.shift()!
    const abandoned = new AbortController()
    void (await import('../../src/server/services/generation')).handleGenerationJob(h.deps, job, abandoned.signal, 'req_abandoned')
    while (h.providerCalls.length === 0) await new Promise((resolve) => setTimeout(resolve, 10)) // claimed and sent
    h.advance(121_000)
    const view = await runView(runId) // the owner read reconciles leases
    const expired = view.generations.filter((g: any) => g.status === 'uncertain')
    expect(expired).toHaveLength(1)
    expect(expired[0]).toMatchObject({ sampleNo: 1, errorCode: 'PROVIDER_LEASE_EXPIRED' })
    expect(view.generations.filter((g: any) => g.caseKey === expired[0].caseKey && g.configurationKey === expired[0].configurationKey && g.sampleNo === 2)[0].status).toBe('pending')
    abandoned.abort()
  })
})

describe('repeats: special master', () => {
  it('grades only the primary answers: eligible questions × parties', async () => {
    h = await createHarness({ env: { MAX_DAILY_CALLS_PER_USER: '100' } })
    const { setup, started } = await startWithSamples(3)
    const runId = started.json.data.runId
    await drainAllSamples(3)
    await scoreAndUnseal(runId)
    const graded = await h.request('POST', `/runs/${runId}/special-master`, {
      as: OWNER,
      body: { modelKey: 'openai-gpt-6-luna', credentialIdsByProvider: { openai: setup.openaiKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(graded.status).toBe(202)
    expect(graded.json.data.plannedCalls).toBe(10)
  })
})

describe('repeats: blinding', () => {
  it('gives jurors the same review and run view shape at 1 and 3 samples, and nothing before reveal', async () => {
    const shapes: unknown[] = []
    const runViews: unknown[] = []
    for (const samples of [undefined, 3] as const) {
      h = await createHarness({ env: { MAX_DAILY_CALLS_PER_USER: '100' } })
      const { started } = await startWithSamples(samples)
      const runId = started.json.data.runId
      await drainAllSamples(samples ?? 1)
      expect((await runView(runId)).status).toBe('reviewing')
      const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
      const token = new URL(invite.json.data.url).hash.replace('#token=', '')
      expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
      const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
      expect(review.cases.map((c: any) => c.responses.length)).toEqual([2, 2, 2, 2, 2])
      shapes.push(keysDeep(review))
      runViews.push(keysDeep((await h.request('GET', `/runs/${runId}`, { as: REVIEWER })).json.data))
      expect((await h.request('GET', `/runs/${runId}/results`, { as: REVIEWER })).status).toBe(409)
      expect(JSON.stringify(review)).not.toMatch(/sample/i)
      await h.dispose()
    }
    h = undefined as unknown as Harness
    expect(shapes[1]).toEqual(shapes[0])
    expect(runViews[1]).toEqual(runViews[0])
  })
})
