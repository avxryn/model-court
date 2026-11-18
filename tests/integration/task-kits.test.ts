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
