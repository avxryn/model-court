/**
 * Spec 06 §7 (D-101): the tool loop, on both stores (local D1 and the Durable Object).
 * Provider HTTP is a stub: nothing here is a paid call or evidence that a real one works.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIMITS } from '../../src/domain/limits'
import { EXAMPLE_TOOL_TASK } from '../../src/domain/tools/task'
import { exportSnapshot, restoreSnapshot } from '../../src/server/services/backup'
import { reconcileLeases } from '../../src/server/services/generation'
import { runMaintenance } from '../../src/server/services/maintenance'
import { handleToolStepJob, reconcileStepLeases } from '../../src/server/services/tool-loop'
import { anthropicOk, createHarness, openAiOk, OWNER, REVIEWER, setupOwner, type Harness, type ProviderCall } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

type Setup = Awaited<ReturnType<typeof setupOwner>>
type Call = { name: string; args: unknown }

function openAiCalls(calls: Call[], text = '') {
  return new Response(
    JSON.stringify({
      id: 'resp_tool',
      status: 'completed',
      model: 'gpt-6-luna',
      output: [
        { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'gAAA-SENTINEL-REASONING' },
        ...(text ? [{ id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] : []),
        ...calls.map((call, index) => ({ id: `fc_${index}`, type: 'function_call', call_id: `call_${crypto.randomUUID().slice(0, 8)}`, name: call.name, arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args), status: 'completed' })),
      ],
      usage: { input_tokens: 200, output_tokens: 30 },
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_openai_tool' } },
  )
}

function anthropicCalls(calls: Call[], text = 'Let me check.') {
  return new Response(
    JSON.stringify({
      id: 'msg_tool',
      type: 'message',
      model: 'claude-haiku-5-5',
      content: [...(text ? [{ type: 'text', text }] : []), ...calls.map((call) => ({ type: 'tool_use', id: `toolu_${crypto.randomUUID().slice(0, 8)}`, name: call.name, input: call.args }))],
      stop_reason: 'tool_use',
      usage: { input_tokens: 210, output_tokens: 25 },
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_anthropic_tool' } },
  )
}

const LOOKUP: Call = { name: 'lookup_order', args: { order_id: 'A-1042' } }
const REFUND: Call = { name: 'refund_shipping', args: { order_id: 'A-1042' } }
const ANSWER = 'Your order is late; I refunded $6.50 of shipping. It arrives in 3 to 5 business days.'

type Reply = (call: ProviderCall) => Response | Promise<Response>

/** A scripted provider: the nth request each provider gets answers with its nth reply (the last one repeats). */
function script(openai: Reply[], anthropic: Reply[] = openai) {
  const seen = { openai: 0, anthropic: 0 }
  h.setProvider(async (call) => {
    const provider = call.url.includes('openai') ? 'openai' : 'anthropic'
    const replies = provider === 'openai' ? openai : anthropic
    const reply = replies[Math.min(seen[provider], replies.length - 1)]
    seen[provider]++
    return reply(call)
  })
}

const callsStep = (calls: Call[]): Reply => (call) => (call.url.includes('openai') ? openAiCalls(calls) : anthropicCalls(calls))
const answerStep = (text = ANSWER): Reply => (call) => (call.url.includes('openai') ? openAiOk(text) : anthropicOk(text))

/** One tools-kit question (and optionally a second) with the example task, saved as revision 2. */
async function toolCase(options: { maxSteps?: number; questions?: number } = {}) {
  const setup = await setupOwner(h)
  const { schemaVersion: _v, ...base } = setup.draft
  const kitFields = { kind: 'tools', ...EXAMPLE_TOOL_TASK, maxSteps: options.maxSteps ?? 4, expect: { ...EXAMPLE_TOOL_TASK.expect, targetSteps: undefined, finalAnswer: { mode: 'contains', value: 'SENTINEL-EXPECTED' } } }
  const cases = Array.from({ length: options.questions ?? 1 }, (_, index) => ({
    key: crypto.randomUUID(),
    title: `Late order ${index + 1}`,
    input: `Where is my order A-1042? If it is late, refund the shipping. (${index + 1})`,
    reference: '',
    expectedBehavior: 'SENTINEL-JURY Looks the order up before refunding.',
    kitFields,
  }))
  const draft = { ...base, kit: { version: 'tools-v1', settings: {} }, cases }
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body: draft })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  return { setup, cases, revision: 2 }
}

async function start(setup: Setup, revision = 2) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: revision, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

async function rows<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T[]> {
  return (await h.db.prepare(sql).bind(...binds).all<T>()).results
}

async function allocated(): Promise<number> {
  return Number((await h.db.prepare('SELECT allocated_units FROM budget_buckets WHERE subject = ?').bind(`user:${OWNER}`).first<{ allocated_units: number }>())?.allocated_units ?? 0)
}

/** Units by state across both reservation tables. */
async function units() {
  const steps = await rows<{ state: string; n: number }>('SELECT state, COUNT(*) AS n FROM step_reservations GROUP BY state')
  const attempts = await rows<{ n: number }>('SELECT COUNT(*) AS n FROM attempt_reservations')
  const by = (state: string) => Number(steps.find((row) => row.state === state)?.n ?? 0)
  return { reserved: by('reserved'), consumed: by('consumed'), released: by('released'), attemptRows: Number(attempts[0]?.n ?? 0) }
}

/** The bucket equals what is still held: consumed plus reserved units, never more or less (no leak, no double release). */
async function expectBalanced() {
  const u = await units()
  expect(await allocated()).toBe(u.consumed + u.reserved)
}

async function runView(runId: string) {
  return (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
}

describe('tool loop: the happy path (spec 06 §7.2–7.5)', () => {
  it('runs three steps per party, stores one trace, releases the unused unit and opens review', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), callsStep([REFUND]), answerStep()])
    const started = await start(setup)
    expect(started.status, JSON.stringify(started.json)).toBe(202)
    expect(started.json.data).toMatchObject({ plannedCalls: 8, plannedCallsAreUpperBound: true })
    expect(await allocated()).toBe(8)
    expect(await units()).toEqual({ reserved: 8, consumed: 0, released: 0, attemptRows: 0 })

    const outcomes = await h.drainJobs()
    expect(outcomes.filter((outcome) => outcome === 'succeeded')).toHaveLength(2)
    expect(outcomes.filter((outcome) => outcome === 'continued')).toHaveLength(4)
    expect(h.providerCalls).toHaveLength(6)
    expect(new Set(h.providerCalls.map((call) => call.url))).toEqual(new Set(['https://api.openai.com/v1/responses', 'https://api.anthropic.com/v1/messages']))
    expect(await units()).toEqual({ reserved: 0, consumed: 6, released: 2, attemptRows: 0 })
    expect(await allocated()).toBe(6)

    const attempts = await rows<{ kind: string; status: string; steps_used: number; output_text: string; trace_json: string; input_tokens: number }>('SELECT kind, status, steps_used, output_text, trace_json, input_tokens FROM generation_attempts')
    expect(attempts).toHaveLength(2)
    for (const attempt of attempts) {
      expect(attempt).toMatchObject({ kind: 'tool_loop', status: 'succeeded', steps_used: 3, output_text: ANSWER })
      const trace = JSON.parse(attempt.trace_json)
      expect(trace).toMatchObject({ version: 'tool-trace-v1', ended: 'answered', finalAnswer: ANSWER })
      expect(trace.steps.map((step: { calls: Array<{ tool: string; source: string }> }) => step.calls.map((call) => `${call.tool}:${call.source}`))).toEqual([['lookup_order:match'], ['refund_shipping:match'], []])
      expect(attempt.input_tokens).toBeGreaterThan(500)
    }
    expect((await rows('SELECT COUNT(*) AS n FROM generation_steps WHERE replay_json IS NOT NULL'))[0]).toEqual({ n: 0 })
    expect((await rows<{ n: number }>('SELECT COUNT(*) AS n FROM testimony_checks'))[0].n).toBe(2)
    expect((await runView(started.json.data.runId)).status).toBe('reviewing')
    await expectBalanced()
  })

  it('replays each step verbatim, sends the same system and tools every step, and never sends expectations', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), callsStep([REFUND]), answerStep()])
    await start(setup)
    await h.drainJobs()
    const openai = h.providerCalls.filter((call) => call.url.includes('openai'))
    const anthropic = h.providerCalls.filter((call) => call.url.includes('anthropic'))
    expect(openai).toHaveLength(3)
    // Step 2 carries step 1's output items as returned, then the mock output for its call id.
    const input = openai[1].body.input as Array<Record<string, unknown>>
    expect(input[1]).toMatchObject({ type: 'reasoning', encrypted_content: 'gAAA-SENTINEL-REASONING' })
    expect(input[2]).toMatchObject({ type: 'function_call', name: 'lookup_order' })
    expect(input[3]).toEqual({ type: 'function_call_output', call_id: input[2].call_id, output: EXAMPLE_TOOL_TASK.tools[0].responses[0].output })
    expect((openai[2].body.input as unknown[]).length).toBe(7)
    const messages = anthropic[2].body.messages as Array<{ role: string; content: unknown }>
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect((messages[2].content as Array<Record<string, unknown>>)[0]).toMatchObject({ type: 'tool_result', is_error: false, content: EXAMPLE_TOOL_TASK.tools[0].responses[0].output })
    for (const group of [openai, anthropic]) {
      expect(new Set(group.map((call) => JSON.stringify([call.body.instructions ?? call.body.system, call.body.tools])))).toHaveProperty('size', 1)
    }
    const sent = JSON.stringify(h.providerCalls.map((call) => call.body))
    for (const hidden of ['SENTINEL-EXPECTED', 'SENTINEL-JURY', 'requiredCalls', 'No order with that ID', 'shipping refund.']) expect(sent).not.toContain(hidden)
    // Keys only in headers; job payloads carry ids and numbers only.
    expect(sent).not.toContain('SENTINEL-OPENAI-KEY')
    const audit = JSON.stringify(await rows('SELECT metadata_json FROM audit_events'))
    expect(audit).not.toContain('SENTINEL')
    expect(audit).not.toContain('A-1042')
  })

  it('a trace that stops at the step cap is valid, eligible testimony with its last calls unsent', async () => {
    const { setup } = await toolCase({ maxSteps: 2 })
    script([callsStep([LOOKUP]), callsStep([REFUND, LOOKUP])])
    const started = await start(setup)
    expect(started.json.data.plannedCalls).toBe(4)
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(4)
    const attempts = await rows<{ status: string; output_text: string; trace_json: string }>('SELECT status, output_text, trace_json FROM generation_attempts')
    for (const attempt of attempts) {
      const trace = JSON.parse(attempt.trace_json)
      expect(attempt.status).toBe('succeeded')
      expect(attempt.output_text).toBe('')
      expect(trace.ended).toBe('step_cap')
      expect(trace.finalAnswer).toBeNull()
      expect(trace.steps[1].calls.map((call: { result: unknown }) => call.result)).toEqual([{ notSent: true }, { notSent: true }])
    }
    expect(await units()).toMatchObject({ reserved: 0, consumed: 4, released: 0 })
    expect((await runView(started.json.data.runId)).eligibility.caseKeys).toHaveLength(1)
    await expectBalanced()
  })
})

describe('tool loop: duplicates, crashes and leases (spec 06 §7.3, §7.6)', () => {
  it('a duplicate generation job and a duplicate step job are not claimed and send nothing', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), answerStep()])
    await start(setup)
    const first = h.jobs[0]
    h.jobs.push({ ...first })
    const stepJobs: typeof h.toolStepJobs = []
    const original = h.deps.enqueueToolStep
    h.deps.enqueueToolStep = async (job) => {
      stepJobs.push({ ...job })
      return original(job)
    }
    const outcomes = await h.drainJobs()
    expect(outcomes.filter((outcome) => outcome === 'not_claimed')).toHaveLength(1)
    const calls = h.providerCalls.length
    expect(calls).toBe(4)
    for (const job of stepJobs) expect(await handleToolStepJob(h.deps, job, new AbortController().signal, 'dup')).toBe('not_claimed')
    expect(h.providerCalls).toHaveLength(calls)
    expect(Object.keys(stepJobs[0]).sort()).toEqual(['attemptNo', 'generationId', 'stepId', 'stepNo', 'stepOutboxId'])
    await expectBalanced()
  })

  it('a crash after a step commit, before its enqueue, is resumed by the cron', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), answerStep()])
    const runId = (await start(setup)).json.data.runId
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    h.setEnqueueFails(true)
    for (const job of h.jobs.splice(0)) expect(await handleGenerationJob(h.deps, job, new AbortController().signal, 'r')).toBe('continued')
    expect(h.toolStepJobs).toHaveLength(0)
    expect((await rows<{ n: number }>(`SELECT COUNT(*) AS n FROM step_outbox WHERE status = 'pending'`))[0].n).toBe(2)
    // A tool attempt waiting between steps is not an expired call.
    h.advance(LIMITS.attemptLeaseMs * 10)
    expect(await reconcileLeases(h.deps, runId)).toBe(0)
    expect(await reconcileStepLeases(h.deps, runId)).toBe(0)
    h.setEnqueueFails(false)
    await runMaintenance(h.deps)
    expect(h.toolStepJobs).toHaveLength(2)
    await h.drainJobs()
    expect((await rows<{ status: string }>('SELECT status FROM generations')).map((row) => row.status)).toEqual(['succeeded', 'succeeded'])
    await expectBalanced()
  })

  it('a lease that runs out mid-step leaves the attempt uncertain; later steps are released', async () => {
    const { setup } = await toolCase()
    let second = true
    script([
      callsStep([LOOKUP]),
      async (call) => {
        if (second) {
          second = false
          h.advance(LIMITS.attemptLeaseMs + 1)
          await reconcileStepLeases(h.deps)
        }
        return answerStep()(call)
      },
    ])
    await start(setup)
    const outcomes = await h.drainJobs()
    expect(outcomes).toContain('stale')
    const generations = await rows<{ status: string; last_error_code: string | null }>('SELECT status, last_error_code FROM generations ORDER BY provider')
    expect(generations.map((row) => row.status).sort()).toEqual(['succeeded', 'uncertain'])
    expect(generations.find((row) => row.status === 'uncertain')?.last_error_code).toBe('PROVIDER_LEASE_EXPIRED')
    const steps = await rows<{ status: string; error_code: string | null }>(`SELECT status, error_code FROM generation_steps WHERE status = 'uncertain'`)
    expect(steps).toEqual([{ status: 'uncertain', error_code: 'PROVIDER_LEASE_EXPIRED' }])
    // The uncertain party: steps 1 and 2 consumed, 3 and 4 released; the other party used 2 and released 2.
    expect(await units()).toMatchObject({ reserved: 0, consumed: 4, released: 4 })
    await expectBalanced()
  })
})

describe('tool loop: failures (spec 06 §7.5)', () => {
  it('a definite failure at step 2 fails the attempt and releases only the steps after it', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 })])
    await start(setup)
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(4)
    const generations = await rows<{ status: string; last_error_code: string }>('SELECT status, last_error_code FROM generations')
    expect(generations).toEqual([{ status: 'failed', last_error_code: 'PROVIDER_REJECTED_REQUEST' }, { status: 'failed', last_error_code: 'PROVIDER_REJECTED_REQUEST' }])
    expect(await units()).toMatchObject({ reserved: 0, consumed: 4, released: 4 })
    expect((await rows('SELECT COUNT(*) AS n FROM generation_steps WHERE replay_json IS NOT NULL'))[0]).toEqual({ n: 0 })
    await expectBalanced()
  })

  it('a network error at step 2 is uncertain, and step 3 is never sent', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), () => Promise.reject(new Error('connection reset'))])
    await start(setup)
    await h.drainJobs()
    expect(h.providerCalls).toHaveLength(4)
    expect((await rows<{ status: string }>('SELECT status FROM generations')).map((row) => row.status)).toEqual(['uncertain', 'uncertain'])
    expect(await units()).toMatchObject({ reserved: 0, consumed: 4, released: 4 })
    await expectBalanced()
  })

  it('a key that expires before step 3 is sent releases steps 3 onward', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), async (call) => {
      await h.db.prepare('UPDATE provider_credentials SET expires_at = ?').bind(h.now() - 1).run()
      return callsStep([REFUND])(call)
    }, answerStep()])
    await start(setup)
    await h.drainJobs()
    // Step 2 of the first party expired every key; the other party's step 2 and both step 3s never left.
    expect(h.providerCalls.length).toBeLessThanOrEqual(4)
    const generations = await rows<{ last_error_code: string }>('SELECT last_error_code FROM generations')
    expect(generations.map((row) => row.last_error_code)).toContain('CREDENTIAL_EXPIRED')
    const consumed = (await units()).consumed
    expect(consumed).toBe(h.providerCalls.length)
    await expectBalanced()
  })

  it('a retry restarts at step 1, reserves the step cap again and needs the prior-charge acknowledgement', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), () => new Response('{}', { status: 500 }), callsStep([LOOKUP]), answerStep()])
    const runId = (await start(setup)).json.data.runId
    await h.drainJobs()
    const view = await runView(runId)
    const failed = view.generations.map((generation: { id: string }) => generation.id)
    expect((await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: failed } })).status).toBe(422)
    const retry = await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: failed, acknowledgePossiblePriorCharge: true } })
    expect(retry.status, JSON.stringify(retry.json)).toBe(202)
    expect(retry.json.data).toMatchObject({ plannedCalls: 8, plannedCallsAreUpperBound: true })
    expect((await rows<{ n: number }>(`SELECT COUNT(*) AS n FROM step_reservations WHERE attempt_no = 2 AND state = 'reserved'`))[0].n).toBe(8)
    await h.drainJobs()
    const attempts = await rows<{ attempt_no: number; status: string; steps_used: number }>('SELECT attempt_no, status, steps_used FROM generation_attempts ORDER BY attempt_no')
    expect(attempts.filter((attempt) => attempt.attempt_no === 2)).toEqual([{ attempt_no: 2, status: 'succeeded', steps_used: 2 }, { attempt_no: 2, status: 'succeeded', steps_used: 2 }])
    const firstSteps = await rows<{ step_no: number }>('SELECT step_no FROM generation_steps WHERE attempt_no = 2 ORDER BY step_no')
    expect(firstSteps[0].step_no).toBe(1)
    await expectBalanced()
  })

  it('refuses a hearing whose worst case does not fit the daily allowance', async () => {
    await h.dispose()
    h = await createHarness({ env: { MAX_DAILY_CALLS_PER_USER: '7' } })
    const { setup } = await toolCase()
    const refused = await start(setup)
    expect(refused.status).toBe(429)
    expect(refused.json.error.code).toBe('QUOTA_EXHAUSTED')
    expect(await allocated()).toBe(0)
    expect(h.providerCalls).toHaveLength(0)
  })
})

describe('tool loop: cancel, delete and revoke (spec 06 §7.7)', () => {
  it('cancel between steps releases every unclaimed step; a late step job sends nothing', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), answerStep()])
    const runId = (await start(setup)).json.data.runId
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    for (const job of h.jobs.splice(0)) await handleGenerationJob(h.deps, job, new AbortController().signal, 'r')
    const view = await runView(runId)
    expect((await h.request('POST', `/runs/${runId}/cancel`, { as: OWNER, ifMatch: view.revision, body: {} })).status).toBe(200)
    expect(await h.drainJobs()).toEqual(['not_claimed', 'not_claimed'])
    expect(h.providerCalls).toHaveLength(2)
    expect(await units()).toMatchObject({ reserved: 0, consumed: 2, released: 6 })
    expect((await rows<{ status: string }>('SELECT DISTINCT status FROM generation_steps WHERE step_no = 2')).map((row) => row.status)).toEqual(['canceled'])
    await expectBalanced()
  })

  it('cancel during a step fences its late result; its unit stays consumed', async () => {
    const { setup } = await toolCase()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    script([callsStep([LOOKUP]), async (call) => {
      await gate
      return answerStep()(call)
    }])
    const runId = (await start(setup)).json.data.runId
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    for (const job of h.jobs.splice(0)) await handleGenerationJob(h.deps, job, new AbortController().signal, 'r')
    const step = h.toolStepJobs.shift()!
    const pending = handleToolStepJob(h.deps, step, new AbortController().signal, 'r')
    while (h.providerCalls.length < 3) await new Promise((resolve) => setTimeout(resolve, 10))
    const view = await runView(runId)
    expect((await h.request('POST', `/runs/${runId}/cancel`, { as: OWNER, ifMatch: view.revision, body: {} })).status).toBe(200)
    release()
    expect(await pending).toBe('stale')
    expect((await rows<{ status: string }>(`SELECT status FROM generation_attempts`)).map((row) => row.status)).toEqual(['canceled', 'canceled'])
    expect(await units()).toMatchObject({ reserved: 0, consumed: 3, released: 5 })
    await expectBalanced()
  })

  it('delete between steps stops the loop and releases unclaimed steps', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), answerStep()])
    await start(setup)
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    for (const job of h.jobs.splice(0)) await handleGenerationJob(h.deps, job, new AbortController().signal, 'r')
    const evaluation = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    expect((await h.request('DELETE', `/evaluations/${setup.evaluationId}`, { as: OWNER, ifMatch: evaluation.revision, body: { confirmTitle: evaluation.title } })).status).toBe(202)
    expect(await h.drainJobs()).toEqual(['not_claimed', 'not_claimed'])
    expect((await rows<{ status: string }>('SELECT DISTINCT status FROM generations')).map((row) => row.status)).toEqual(['canceled'])
    expect((await rows<{ status: string }>('SELECT DISTINCT status FROM generation_attempts')).map((row) => row.status)).toEqual(['canceled'])
    expect(await units()).toMatchObject({ reserved: 0, consumed: 2, released: 6 })
    await expectBalanced()
  })

  it('revoking a key between steps fails that party; during a step it is uncertain', async () => {
    const { setup } = await toolCase()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    script([callsStep([LOOKUP]), async (call) => {
      if (call.url.includes('openai')) await gate
      return answerStep()(call)
    }])
    await start(setup)
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    for (const job of h.jobs.splice(0)) await handleGenerationJob(h.deps, job, new AbortController().signal, 'r')
    // Start OpenAI's step 2 (it hangs); Anthropic's step 2 stays queued.
    const generations = await rows<{ id: string; provider: string }>('SELECT id, provider FROM generations')
    const openaiGen = generations.find((row) => row.provider === 'openai')!.id
    const openaiStep = h.toolStepJobs.find((job) => job.generationId === openaiGen)!
    h.toolStepJobs.splice(h.toolStepJobs.indexOf(openaiStep), 1)
    const pending = handleToolStepJob(h.deps, openaiStep, new AbortController().signal, 'r')
    while (h.providerCalls.length < 3) await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await h.request('DELETE', `/credentials/${setup.openaiKeyId}`, { as: OWNER, ifMatch: 1 })).status).toBe(204)
    expect((await h.request('DELETE', `/credentials/${setup.anthropicKeyId}`, { as: OWNER, ifMatch: 1 })).status).toBe(204)
    release()
    expect(await pending).toBe('stale')
    expect(await h.drainJobs()).toEqual(['not_claimed'])
    const after = await rows<{ provider: string; status: string; last_error_code: string }>('SELECT provider, status, last_error_code FROM generations ORDER BY provider')
    expect(after).toEqual([
      { provider: 'anthropic', status: 'failed', last_error_code: 'CREDENTIAL_REVOKED' },
      { provider: 'openai', status: 'uncertain', last_error_code: 'CREDENTIAL_REVOKED' },
    ])
    // OpenAI: steps 1 and 2 consumed (2 may be billed), 3–4 released. Anthropic: step 1 consumed, 2–4 released.
    expect(await units()).toMatchObject({ reserved: 0, consumed: 3, released: 5 })
    await expectBalanced()
  })
})

describe('tool loop: records (spec 06 §4.3, §11.2)', () => {
  it('a party’s results depend only on its own calls', async () => {
    const { setup } = await toolCase()
    script([callsStep([{ name: 'lookup_order', args: { id: 'x' } }]), answerStep()], [callsStep([LOOKUP]), answerStep()])
    await start(setup)
    await h.drainJobs()
    const traces = (await rows<{ provider: string; trace_json: string }>('SELECT g.provider, a.trace_json FROM generation_attempts a JOIN generations g ON g.id = a.generation_id ORDER BY g.provider')).map((row) => ({ provider: row.provider, trace: JSON.parse(row.trace_json) }))
    expect(traces[0].trace.steps[0].calls[0]).toMatchObject({ source: 'match', result: { isError: false } })
    expect(traces[1].trace.steps[0].calls[0]).toMatchObject({ source: 'invalid_arguments', result: { text: EXAMPLE_TOOL_TASK.tools[0].errorResponse.output, isError: true } })
  })

  it('finished traces and steps are immutable; replay data may only be dropped', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), answerStep()])
    await start(setup)
    await h.drainJobs()
    await expect(h.db.prepare(`UPDATE generation_attempts SET trace_json = '{}'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_ATTEMPTS/)
    await expect(h.db.prepare(`UPDATE generation_attempts SET steps_used = 1`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_ATTEMPTS/)
    await expect(h.db.prepare(`UPDATE generation_steps SET text = 'x'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_STEPS/)
    await expect(h.db.prepare(`UPDATE generation_steps SET calls_json = '[]'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_STEPS/)
    await expect(h.db.prepare(`UPDATE generation_steps SET replay_json = '{}'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_STEPS/)
    await h.db.prepare(`UPDATE generation_steps SET replay_json = NULL`).run()
  })

  it('backups carry the step tables without replay data, and a restore fences unfinished loops', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), answerStep()])
    await start(setup)
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    for (const job of h.jobs.splice(0)) await handleGenerationJob(h.deps, job, new AbortController().signal, 'r')
    expect((await rows<{ n: number }>('SELECT COUNT(*) AS n FROM generation_steps WHERE replay_json IS NOT NULL'))[0].n).toBe(2)
    const snapshot = await exportSnapshot(h.deps)
    expect(snapshot.tables.generation_steps).toHaveLength(4)
    expect(snapshot.tables.generation_steps.every((row) => row.replay_json === null)).toBe(true)
    expect(snapshot.tables.step_reservations).toHaveLength(8)
    expect(snapshot.tables.step_outbox).toHaveLength(2)
    expect(JSON.stringify(snapshot.tables)).not.toContain('SENTINEL-REASONING')

    const target = await createHarness()
    try {
      await restoreSnapshot(target.deps, snapshot)
      const steps = (await target.db.prepare('SELECT step_no, status FROM generation_steps ORDER BY step_no').all<{ step_no: number; status: string }>()).results
      expect(steps.filter((step) => step.step_no === 2).map((step) => step.status)).toEqual(['canceled', 'canceled'])
      const reserved = await target.db.prepare(`SELECT COUNT(*) AS n FROM step_reservations WHERE state = 'reserved'`).first<{ n: number }>()
      expect(Number(reserved?.n)).toBe(0)
      expect((await target.db.prepare('SELECT DISTINCT status FROM generations').all<{ status: string }>()).results.map((row) => row.status)).toEqual(['failed'])
    } finally {
      await target.dispose()
    }
  })
})

const PROVIDER_ID_PREFIXES = ['call_', 'fc_', 'rs_', 'msg_', 'toolu_', 'srvtoolu_', 'req_openai_tool', 'req_anthropic_tool']

async function seatJuror(runId: string) {
  const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  const token = new URL(invite.json.data.url).hash.replace('#token=', '')
  expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
}

async function reveal(runId: string) {
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
  const ratings = review.cases.flatMap((c: { responses: Array<{ responseId: string }> }) => c.responses.map((r) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings } })
  expect(saved.status, JSON.stringify(saved.json)).toBe(200)
  expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
  const view = await runView(runId)
  const revealed = await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: view.review?.pendingCount ?? 0 } })
  expect(revealed.status, JSON.stringify(revealed.json)).toBe(200)
}

describe('tool hearings: read paths (spec 06 §5, D-102)', () => {
  it('jurors get the tools and an allowlisted trace, and nothing that tells the providers apart', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), callsStep([REFUND]), answerStep()])
    const runId = (await start(setup)).json.data.runId
    await h.drainJobs()
    await seatJuror(runId)
    for (const who of [REVIEWER, OWNER]) {
      const review = await h.request('GET', `/runs/${runId}/review`, { as: who })
      expect(review.status).toBe(200)
      const testCase = review.json.data.cases[0]
      expect(testCase.kitView).toEqual({ kind: 'tools', tools: EXAMPLE_TOOL_TASK.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), maxSteps: 4 })
      for (const response of testCase.responses) {
        expect(response.text).toBe(ANSWER)
        expect(Object.keys(response.trace).sort()).toEqual(['ended', 'finalAnswer', 'steps'])
        expect(response.trace.ended).toBe('answered')
        expect(response.trace.steps[0].calls[0]).toEqual({ callNo: 1, tool: 'lookup_order', knownTool: true, arguments: '{\n  "order_id": "A-1042"\n}', result: { text: EXAMPLE_TOOL_TASK.tools[0].responses[0].output, isError: false } })
      }
      // The two parties' traces differ only in their own narration.
      const [a, b] = testCase.responses.map((response: { trace: { steps: Array<{ calls: unknown[] }> } }) => response.trace.steps.map((step) => step.calls))
      expect(a).toEqual(b)
      const json = JSON.stringify(review.json.data)
      for (const prefix of PROVIDER_ID_PREFIXES) expect(json).not.toContain(prefix)
      for (const hidden of ['source', 'responseIndex', 'finishReason', 'tool_use', 'end_turn', 'SENTINEL-EXPECTED', 'required-calls', 'inputTokens', 'durationMs', 'gpt-6', 'claude']) expect(json).not.toContain(hidden)
    }
    expect((await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).status).toBe(409)
  })

  it('the owner sees step counts while generating; results and the record carry the full trace after unsealing', async () => {
    const { setup } = await toolCase()
    script([callsStep([LOOKUP]), callsStep([REFUND]), answerStep()])
    const runId = (await start(setup)).json.data.runId
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    for (const job of h.jobs.splice(0)) await handleGenerationJob(h.deps, job, new AbortController().signal, 'r')
    const during = await runView(runId)
    expect(during.generations.map((generation: { steps: unknown }) => generation.steps)).toEqual([{ used: 1, max: 4 }, { used: 1, max: 4 }])
    expect(JSON.stringify(during)).not.toContain('inputTokens')
    await h.drainJobs()
    expect((await runView(runId)).generations[0].steps).toEqual({ used: 3, max: 4 })
    await seatJuror(runId)
    await reveal(runId)
    const results = await h.request('GET', `/runs/${runId}/results`, { as: OWNER })
    expect(results.status).toBe(200)
    const response = results.json.data.cases[0].responses[0]
    expect(response.trace).toMatchObject({ version: 'tool-trace-v1', ended: 'answered' })
    expect(response.trace.steps[0].calls[0]).toMatchObject({ source: 'match', responseIndex: 0 })
    expect(response.steps.map((step: { stepNo: number }) => step.stepNo)).toEqual([1, 2, 3])
    expect(response.steps[0]).toMatchObject({ inputTokens: expect.any(Number), outputTokens: expect.any(Number), truncated: false })
    expect(response.checks.map((check: { checkId: string }) => check.checkId)).toEqual(['required-calls', 'forbidden-not-called', 'arguments-valid', 'steps-used', 'finished', 'final-answer'])
    const record = await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })
    expect(record.status).toBe(200)
    const text = record.text
    expect(text).toContain('tool-trace-v1')
    expect(text).toContain('"kind":"tools"')
    for (const prefix of PROVIDER_ID_PREFIXES) expect(text).not.toContain(prefix)
    expect(text).not.toContain('replay')
    expect(text).not.toContain('SENTINEL-REASONING')
  })

  it('the special master is not offered for tool hearings', async () => {
    const { setup } = await toolCase()
    script([answerStep()])
    const runId = (await start(setup)).json.data.runId
    await h.drainJobs()
    await seatJuror(runId)
    await reveal(runId)
    const refused = await h.request('POST', `/runs/${runId}/special-master`, { as: OWNER, body: { modelKey: 'openai-gpt-6-luna', credentialIdsByProvider: { openai: setup.openaiKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true } })
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toBe("The AI grader isn't available for tool-use cases yet.")
  })
})
