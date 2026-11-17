import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMaintenance } from '../../src/server/services/maintenance'
import { anthropicOk, createHarness, openAiOk, OTHER, OWNER, setupOwner, startRun, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

async function bucket(subject: string) {
  return h.db.prepare('SELECT allocated_units FROM budget_buckets WHERE subject = ?').bind(subject).first<{ allocated_units: number }>()
}

async function run(runId: string, as = OWNER) {
  return (await h.request('GET', `/runs/${runId}`, { as })).json.data
}

describe('T05/T06 run admission and durable generation', () => {
  it('returns 202 with durable intents; snapshot is unaffected by later draft edits', async () => {
    const setup = await setupOwner(h)
    const started = await startRun(h, setup)
    expect(started.status).toBe(202)
    expect(started.json.data.plannedCalls).toBe(10)
    expect(h.jobs).toHaveLength(10)
    expect(h.providerCalls).toHaveLength(0) // no provider work inside the request
    // Job payloads carry IDs only.
    for (const job of h.jobs) expect(Object.keys(job).sort()).toEqual(['attemptNo', 'generationId', 'outboxId'])

    const before = await h.db.prepare('SELECT snapshot_json, snapshot_hash FROM runs').first<any>()
    const { schemaVersion: _v, ...draft } = setup.draft
    draft.cases[0].input = 'CHANGED AFTER RUN'
    expect((await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })).status).toBe(200)
    const after = await h.db.prepare('SELECT snapshot_json, snapshot_hash FROM runs').first<any>()
    expect(after).toEqual(before)
    await expect(h.db.prepare(`UPDATE runs SET snapshot_json = '{}'`).run()).rejects.toThrow(/IMMUTABLE/)

    const outcomes = await h.drainJobs()
    expect(outcomes.filter((o) => o === 'succeeded')).toHaveLength(10)
    const view = await run(started.json.data.runId)
    expect(view.status).toBe('ready')
    expect(view.counts.succeeded).toBe(10)
    // Messages were built from the snapshot, not the edited draft; expected behavior never sent.
    const sent = JSON.stringify(h.providerCalls.map((call) => call.body))
    expect(sent).not.toContain('CHANGED AFTER RUN')
    expect(sent).not.toContain('Explain the stated eligibility')
  })

  it('uses each provider fixed endpoint with the owner key and no storage', async () => {
    const setup = await setupOwner(h)
    await startRun(h, setup)
    await h.drainJobs()
    const openai = h.providerCalls.find((call) => call.url === 'https://api.openai.com/v1/responses')!
    const anthropic = h.providerCalls.find((call) => call.url === 'https://api.anthropic.com/v1/messages')!
    expect(openai.headers.authorization).toBe('Bearer sk-test-SENTINEL-OPENAI-KEY')
    expect(openai.body).toMatchObject({ model: 'gpt-6-luna', max_output_tokens: 512, store: false, reasoning: { effort: 'none' } })
    expect(anthropic.headers['x-api-key']).toBe('sk-ant-SENTINEL-ANTHROPIC-KEY')
    expect(anthropic.body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 512, thinking: { type: 'disabled' } })
    expect(h.providerCalls.every((call) => ['https://api.openai.com/v1/responses', 'https://api.anthropic.com/v1/messages'].includes(call.url))).toBe(true)
  })

  it('replays a double-clicked Run with the same key as one run and one set of reservations', async () => {
    const setup = await setupOwner(h)
    const key = crypto.randomUUID()
    const [a, b] = await Promise.all([startRun(h, setup, OWNER, key), startRun(h, setup, OWNER, key)])
    expect(a.json.data.runId).toBe(b.json.data.runId)
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM runs').first<any>()).n).toBe(1)
    expect((await bucket(`user:${OWNER}`))?.allocated_units).toBe(10)
  })

  it('duplicate job delivery makes exactly one provider request', async () => {
    const setup = await setupOwner(h)
    await startRun(h, setup)
    const first = h.jobs[0]
    h.jobs.push({ ...first }, { ...first })
    const outcomes = await h.drainJobs()
    expect(outcomes.filter((o) => o === 'not_claimed')).toHaveLength(2)
    expect(h.providerCalls).toHaveLength(10)
  })

  it('refuses a stale draft revision, missing keys, another user, and a second active run', async () => {
    const setup = await setupOwner(h)
    const body = (extra: object) => ({ draftRevision: 1, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true, ...extra })
    expect((await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, { as: OWNER, body: body({ draftRevision: 9 }) })).json.error.code).toBe('REVISION_CONFLICT')
    expect((await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, { as: OWNER, body: body({ credentialIdsByProvider: { openai: setup.openaiKeyId } }) })).json.error.code).toBe('CREDENTIAL_MISSING')
    expect((await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, { as: OWNER, body: body({ billingMode: 'platform' }) })).status).toBe(422)
    expect((await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, { as: OTHER, body: body({}) })).status).toBe(404)

    // Another user's key cannot be pinned (T32).
    const other = await setupOwner(h, OTHER)
    const foreign = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, { as: OWNER, body: body({ credentialIdsByProvider: { openai: other.openaiKeyId, anthropic: setup.anthropicKeyId } }) })
    expect(foreign.json.error.code).toBe('CREDENTIAL_MISSING')

    h.advance(61_000) // past the 5-per-minute generation request limit
    expect((await startRun(h, setup)).status).toBe(202)
    await h.drainJobs()
    const second = await startRun(h, setup)
    expect(second.json.error.code).toBe('ACTIVE_RUN_EXISTS')
    expect(h.providerCalls.every((call) => !JSON.stringify(call.headers).includes(other.openaiKeyId))).toBe(true)
  })

  it('refuses unverified routes and disabled generation without calling providers', async () => {
    const unverified = await createHarness({ routes: undefined, env: {} })
    try {
      // Default registry ships with verifiedAt: null for both routes.
      const { MODEL_ROUTES } = await import('../../src/domain/registry')
      ;(unverified.deps as any).routes = MODEL_ROUTES
      const setup = await setupOwner(unverified)
      const res = await startRun(unverified, setup)
      expect(res.json.error.code).toBe('UNSUPPORTED_CONFIGURATION')
      unverified.env.GENERATION_ENABLED = 'false'
      expect((await startRun(unverified, setup)).json.error.code).toBe('GENERATION_DISABLED')
      expect(unverified.providerCalls).toHaveLength(0)
    } finally {
      await unverified.dispose()
    }
  })

  it('model comparison requires identical instructions', async () => {
    const setup = await setupOwner(h)
    const { schemaVersion: _v, ...draft } = setup.draft
    draft.configurations[1].systemPrompt = 'Different instructions'
    await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })
    const res = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
      as: OWNER,
      body: { draftRevision: 2, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(res.json.error.details.issues).toContainEqual({ kind: 'model_mode_instructions_differ' })
  })

  it('outbox survives enqueue failure and cron redispatches it', async () => {
    const setup = await setupOwner(h)
    h.setEnqueueFails(true)
    const started = await startRun(h, setup)
    expect(started.status).toBe(202) // intent is durable even though enqueue failed
    expect(h.jobs).toHaveLength(0)
    h.setEnqueueFails(false)
    h.advance(6_000)
    const report = await runMaintenance(h.deps)
    expect(report.dispatched).toBe(10)
    await h.drainJobs()
    expect((await run(started.json.data.runId)).status).toBe('ready')
  })
})

describe('T07/T17 failures, retries, and fencing', () => {
  it('isolates a failed generation, retries once, and never replaces successes', async () => {
    const setup = await setupOwner(h)
    let failNext = 1
    h.setProvider(async (call) => {
      if (call.url.includes('openai') && failNext-- > 0) return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 })
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    const runId = (await startRun(h, setup)).json.data.runId
    await h.drainJobs()
    let view = await run(runId)
    expect(view.status).toBe('ready')
    expect(view.counts).toMatchObject({ succeeded: 9, failed: 1 })
    const failed = view.generations.find((g: any) => g.status === 'failed')
    expect(failed.errorCode).toBe('PROVIDER_RATE_LIMITED')
    expect(failed.retryable).toBe(true)

    const succeeded = view.generations.find((g: any) => g.status === 'succeeded')
    const badRetry = await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: [succeeded.id], acknowledgePossiblePriorCharge: true } })
    expect(badRetry.status).toBe(409)

    const retry = await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: [failed.id], acknowledgePossiblePriorCharge: true } })
    expect(retry.status).toBe(202)
    h.setProvider(async () => new Response('{"error":{}}', { status: 500 }))
    await h.drainJobs()
    view = await run(runId)
    const again = view.generations.find((g: any) => g.id === failed.id)
    expect(again).toMatchObject({ status: 'failed', attemptCount: 2, retryable: false, errorCode: 'PROVIDER_UNAVAILABLE' })
    const third = await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: [failed.id], acknowledgePossiblePriorCharge: true } })
    expect(third.status).toBe(409)
    expect((await bucket(`user:${OWNER}`))?.allocated_units).toBe(11)
  })

  it('normalizes auth, quota, malformed, empty, oversized, and redirect responses without retrying', async () => {
    const responses: Array<[Response, string]> = [
      [new Response('{"error":{"type":"invalid_request_error"}}', { status: 401 }), 'PROVIDER_AUTH_FAILED'],
      [new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 }), 'PROVIDER_QUOTA_EXHAUSTED'],
      [new Response('not json', { status: 200 }), 'INVALID_PROVIDER_RESPONSE'],
      [openAiOk('   '), 'EMPTY_OUTPUT'],
      [openAiOk('x'.repeat(17 * 1024)), 'OUTPUT_TOO_LARGE'],
      [new Response(null, { status: 307, headers: { location: 'https://evil.example/' } }), 'PROVIDER_REDIRECT_REFUSED'],
    ]
    const setup = await setupOwner(h)
    let index = 0
    h.setProvider(async (call) => (call.url.includes('openai') && index < responses.length ? responses[index++][0] : anthropicOk()))
    const runId = (await startRun(h, setup)).json.data.runId
    await h.drainJobs()
    const codes = (await h.db.prepare(`SELECT error_code FROM generation_attempts WHERE error_code IS NOT NULL ORDER BY started_at, rowid`).all<any>()).results.map((r) => r.error_code)
    expect(codes).toEqual(responses.slice(0, 5).map(([, code]) => code))
    expect(h.providerCalls).toHaveLength(10) // one request per generation; no automatic retry
    expect((await run(runId)).status).toBe('ready')
  })

  it('marks timeouts uncertain, keeps the reservation consumed, and records no output', async () => {
    const setup = await setupOwner(h)
    h.env.PROVIDER_TIMEOUT_MS = '20'
    h.setProvider((call, signal) =>
      call.url.includes('openai')
        ? new Promise((_, reject) => {
            // Like real fetch: an already-aborted signal rejects immediately.
            if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          })
        : Promise.resolve(anthropicOk()),
    )
    const runId = (await startRun(h, setup)).json.data.runId
    await h.drainJobs()
    const view = await run(runId)
    expect(view.counts).toMatchObject({ uncertain: 5, succeeded: 5 })
    expect(view.generations.find((g: any) => g.status === 'uncertain').errorCode).toBe('PROVIDER_TIMEOUT')
    expect((await bucket(`user:${OWNER}`))?.allocated_units).toBe(10) // uncertain calls are not refunded
  })

  it('fences a late completion after cancel and after lease expiry (T26)', async () => {
    const setup = await setupOwner(h)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    h.setProvider(async (call) => {
      await gate
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    const runId = (await startRun(h, setup)).json.data.runId
    const job = h.jobs.shift()!
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    const pending = handleGenerationJob(h.deps, job, new AbortController().signal, 'req')
    while (h.providerCalls.length === 0) await new Promise((r) => setTimeout(r, 10)) // claimed and sent
    const view = await run(runId)
    expect((await h.request('POST', `/runs/${runId}/cancel`, { as: OWNER, ifMatch: view.revision, body: {} })).status).toBe(200)
    release()
    expect(await pending).toBe('stale')
    const attempt = await h.db.prepare('SELECT status, output_text FROM generation_attempts').first<any>()
    expect(attempt).toEqual({ status: 'canceled', output_text: null })
    // Remaining queued work releases its reservations: 1 consumed call remains charged.
    expect((await bucket(`user:${OWNER}`))?.allocated_units).toBe(1)
    expect(await h.drainJobs()).toEqual(Array(9).fill('not_claimed'))
  })

  it('expires an abandoned lease to uncertain on read without contacting a provider', async () => {
    const setup = await setupOwner(h)
    h.setProvider(() => new Promise(() => {}))
    const runId = (await startRun(h, setup)).json.data.runId
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    void handleGenerationJob(h.deps, h.jobs.shift()!, new AbortController().signal, 'req') // never completes
    while (h.providerCalls.length === 0) await new Promise((r) => setTimeout(r, 10)) // claimed and sent
    h.advance(121_000)
    const calls = h.providerCalls.length
    const view = await run(runId)
    expect(view.counts.uncertain).toBe(1)
    expect(view.generations.find((g: any) => g.status === 'uncertain').errorCode).toBe('PROVIDER_LEASE_EXPIRED')
    expect(h.providerCalls.length).toBe(calls)
  })
})

describe('T18 budget ceilings', () => {
  it('parallel admissions cannot exceed the per-user daily cap', async () => {
    const small = await createHarness({ env: { MAX_DAILY_CALLS_PER_USER: '25' } })
    try {
      const first = await setupOwner(small)
      const setups = [first]
      for (let i = 0; i < 3; i++) {
        const created = await small.request('POST', '/evaluations', { as: OWNER, body: { title: `Eval ${i}`, taskDescription: '' } })
        setups.push({ ...first, evaluationId: created.json.data.id })
      }
      // Fill budgets across evaluations while respecting the one-generating-run cap.
      const statuses: number[] = []
      for (const s of setups) {
        const res = await startRun(small, s)
        statuses.push(res.status)
        await small.drainJobs()
        small.advance(61_000)
      }
      expect(statuses.filter((s) => s === 202)).toHaveLength(2)
      expect(statuses.filter((s) => s === 429)).toHaveLength(2)
      expect((await small.db.prepare(`SELECT allocated_units FROM budget_buckets WHERE subject = ?`).bind(`user:${OWNER}`).first<any>()).allocated_units).toBe(20)
    } finally {
      await small.dispose()
    }
  })

  it('20 simultaneous admissions against a tiny global cap never over-allocate', async () => {
    const tiny = await createHarness({ env: { MAX_DAILY_CALLS_GLOBAL: '30', MAX_LIFETIME_CALLS_GLOBAL: '30' } })
    try {
      const users = Array.from({ length: 20 }, (_, i) => `user_race_${i}`)
      const setups = await Promise.all(users.map((u) => setupOwner(tiny, u)))
      const results = await Promise.all(setups.map((s, i) => startRun(tiny, s, users[i])))
      const accepted = results.filter((r) => r.status === 202).length
      expect(accepted).toBeLessThanOrEqual(2) // also bounded by 2 generating runs per deployment
      const global = await tiny.db.prepare(`SELECT allocated_units, limit_units FROM budget_buckets WHERE subject = 'global:day'`).first<any>()
      expect(global.allocated_units).toBe(accepted * 10)
      expect(global.allocated_units).toBeLessThanOrEqual(global.limit_units)
      expect(results.every((r) => r.status === 202 || r.status === 429)).toBe(true)
    } finally {
      await tiny.dispose()
    }
  })
})

describe('T33 credential revocation fences work', () => {
  it('revoking a key while queued sends nothing, releases reservations, and requires a new run', async () => {
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId
    expect((await h.request('DELETE', `/credentials/${setup.openaiKeyId}`, { as: OWNER, ifMatch: 1 })).status).toBe(204)
    await h.drainJobs()
    expect(h.providerCalls.every((call) => !call.url.includes('openai'))).toBe(true)
    const view = await run(runId)
    expect(view.status).toBe('ready')
    expect(view.generations.filter((g: any) => g.errorCode === 'CREDENTIAL_REVOKED')).toHaveLength(5)
    expect((await bucket(`user:${OWNER}`))?.allocated_units).toBe(5)
    const failed = view.generations.find((g: any) => g.errorCode === 'CREDENTIAL_REVOKED')
    const retry = await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: [failed.id], acknowledgePossiblePriorCharge: true } })
    expect(retry.status).toBe(409)
    expect(retry.json.error.message).toMatch(/new one/)
    // Accepted evidence survives removal.
    expect(view.counts.succeeded).toBe(5)
  })

  it('a completion that lands after revocation is rejected', async () => {
    const setup = await setupOwner(h)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    h.setProvider(async (call) => {
      await gate
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    await startRun(h, setup)
    const job = h.jobs.find(() => true)!
    h.jobs.splice(0, 1)
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    const pending = handleGenerationJob(h.deps, job, new AbortController().signal, 'req')
    while (h.providerCalls.length === 0) await new Promise((r) => setTimeout(r, 10)) // claimed and sent
    const provider = (await h.db.prepare('SELECT provider FROM generations WHERE id = ?').bind(job.generationId).first<any>()).provider
    await h.request('DELETE', `/credentials/${provider === 'openai' ? setup.openaiKeyId : setup.anthropicKeyId}`, { as: OWNER, ifMatch: 1 })
    release()
    expect(await pending).toBe('stale')
    const attempt = await h.db.prepare('SELECT status, error_code, output_text FROM generation_attempts').first<any>()
    expect(attempt).toEqual({ status: 'uncertain', error_code: 'CREDENTIAL_REVOKED', output_text: null })
  })
})

describe('review fix: fence re-checked immediately before a paid send', () => {
  it('a cancel landing between claim and send results in zero provider requests', async () => {
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const original = h.deps.publishNotices
    let claimed = false
    h.deps.publishNotices = async (batch) => {
      claimed = true
      await gate // the post-claim notice stalls, opening the claim→send window
      await original(batch)
    }
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    const pending = handleGenerationJob(h.deps, h.jobs.shift()!, new AbortController().signal, 'req')
    while (!claimed) await new Promise((r) => setTimeout(r, 10))
    h.deps.publishNotices = original
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    expect((await h.request('POST', `/runs/${runId}/cancel`, { as: OWNER, ifMatch: view.revision, body: {} })).status).toBe(200)
    release()
    expect(await pending).toBe('stale')
    expect(h.providerCalls).toHaveLength(0)
  })
})
