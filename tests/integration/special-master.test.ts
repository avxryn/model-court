/**
 * Phase 6 (D-40): the special master. An advisory AI grader, paid with the
 * judge's own key, available only after unsealing, visible only to the judge,
 * and kept entirely out of the jury's findings.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anthropicOk, createHarness, okStub, openAiOk, openDeliberation, OWNER, REVIEWER, setupOwner, startRun, type Harness, type ProviderStub } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const GRADE = '{"correctness":2,"completeness":1,"grounding":2,"note":"Omits the receipt rule."}'
const isGraderCall = (body: unknown) => JSON.stringify(body).includes('responseToGrade')
const graderStub =
  (reply = GRADE): ProviderStub =>
  async (call, signal) =>
    isGraderCall(call.body) ? (call.url.includes('openai') ? openAiOk(reply) : anthropicOk(reply)) : okStub(call, signal)

async function bucket(subject: string) {
  return (await h.db.prepare('SELECT allocated_units FROM budget_buckets WHERE subject = ?').bind(subject).first<{ allocated_units: number }>())?.allocated_units ?? 0
}

/** A hearing taken through review and unsealing, with one juror who scores A higher than B. */
async function unsealedHearing() {
  const setup = await setupOwner(h)
  h.setProvider(graderStub())
  const runId = (await startRun(h, setup)).json.data.runId as string
  await h.drainJobs()
  let view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
  await openDeliberation(h, runId)
  const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  const token = new URL(invite.json.data.url).hash.replace('#token=', '')
  await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
  const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: r.label === 'A' ? 2 : 1, grounding: 2, note: '', suspectedIdentityClue: false })))
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings } })
  await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: saved.json.data.sessionRevision, body: {} })
  view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
  expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } })).status).toBe(200)
  return { setup, runId }
}

function startGrader(setup: Awaited<ReturnType<typeof setupOwner>>, runId: string, provider: 'openai' | 'anthropic' = 'anthropic') {
  const modelKey = provider === 'openai' ? 'openai-gpt-6-luna' : 'anthropic-claude-haiku-5-5'
  const credentialId = provider === 'openai' ? setup.openaiKeyId : setup.anthropicKeyId
  return h.request('POST', `/runs/${runId}/special-master`, {
    as: OWNER,
    idempotencyKey: crypto.randomUUID(),
    body: { modelKey, credentialIdsByProvider: { [provider]: credentialId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

describe('access and timing', () => {
  it('is refused before unsealing', async () => {
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId
    expect((await startGrader(setup, runId)).status).toBe(409)
  })

  it('is hidden from jurors', async () => {
    const { runId: unsealed } = await unsealedHearing()
    const asJuror = await h.request('GET', `/runs/${unsealed}/special-master`, { as: REVIEWER })
    expect(asJuror.status).toBe(404)
  })

  it('refuses a key for the wrong provider', async () => {
    const { setup, runId } = await unsealedHearing()
    const refused = await h.request('POST', `/runs/${runId}/special-master`, {
      as: OWNER,
      idempotencyKey: crypto.randomUUID(),
      body: { modelKey: 'anthropic-claude-haiku-5-5', credentialIdsByProvider: { openai: setup.openaiKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(refused.status).toBe(422)
  })
})

describe('grading', () => {
  it('grades every eligible response once, blind, with the scoring guide, and calibrates against the jury', async () => {
    const { setup, runId } = await unsealedHearing()
    const before = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    const callsBefore = h.providerCalls.length
    const userBefore = await bucket(`user:${OWNER}`)
    const started = await startGrader(setup, runId)
    expect(started.status).toBe(202)
    expect(started.json.data.plannedCalls).toBe(10)
    expect(await bucket(`user:${OWNER}`)).toBe(userBefore + 10)
    await h.drainJobs()
    const graderCalls = h.providerCalls.slice(callsBefore)
    expect(graderCalls).toHaveLength(10)
    expect(graderCalls.every((call) => call.url.includes('anthropic'))).toBe(true)
    const snapshot = JSON.parse((await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(runId).first<any>()).snapshot_json)
    for (const call of graderCalls) {
      const content = (call.body as any).messages[0].content as string
      expect(snapshot.cases.some((c: any) => content.includes(JSON.stringify(c.expectedBehavior).slice(1, -1)))).toBe(true)
      for (const party of snapshot.configurations) expect(content).not.toContain(party.label)
      expect(content).not.toMatch(/openai|gpt-6-luna|Testimony [AB]/)
    }

    const view = (await h.request('GET', `/runs/${runId}/special-master`, { as: OWNER })).json.data
    const graderRun = view.graderRuns[0]
    expect(graderRun.status).toBe('ready')
    expect(graderRun.counts).toMatchObject({ planned: 10, succeeded: 10 })
    expect(graderRun.selfPreferenceRisk).toBe('same_model')
    expect(graderRun.calibration.items).toBe(10)
    expect(graderRun.calibration.byDimension.correctness.withinJuryRange).toBe(1)
    expect(graderRun.calibration.caveat).toMatch(/too few/)
    expect(graderRun.configHash).toMatch(/^[0-9a-f]{64}$/)

    // The jury's findings and disagreements are untouched.
    const after = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(JSON.stringify(after.cohorts)).toBe(JSON.stringify(before.cohorts))
    expect(JSON.stringify(after.disagreements)).toBe(JSON.stringify(before.disagreements))
    expect(JSON.stringify(after)).not.toContain('Omits the receipt rule.')
  })

  it('records malformed grader output as a failure with no automatic retry', async () => {
    const { setup, runId } = await unsealedHearing()
    h.setProvider(graderStub('Sure! The response is good. {"correctness":2}'))
    await startGrader(setup, runId)
    await h.drainJobs()
    expect(h.gradingJobs).toHaveLength(0)
    const graderRun = (await h.request('GET', `/runs/${runId}/special-master`, { as: OWNER })).json.data.graderRuns[0]
    expect(graderRun.counts).toMatchObject({ planned: 10, succeeded: 0, failed: 10 })
    expect(graderRun.items.every((item: any) => item.errorCode === 'GRADER_INVALID_OUTPUT')).toBe(true)
  })

  it('never decrypts a key removed after starting; the unsent units are released', async () => {
    const { setup, runId } = await unsealedHearing()
    await startGrader(setup, runId)
    const userAfterStart = await bucket(`user:${OWNER}`)
    h.advance(61_000)
    expect((await h.request('DELETE', `/credentials/${setup.anthropicKeyId}`, { as: OWNER, ifMatch: 1 })).status).toBe(204)
    const callsBefore = h.providerCalls.length
    await h.drainJobs()
    expect(h.providerCalls.length).toBe(callsBefore)
    expect(await bucket(`user:${OWNER}`)).toBe(userAfterStart - 10)
    const graderRun = (await h.request('GET', `/runs/${runId}/special-master`, { as: OWNER })).json.data.graderRuns[0]
    expect(graderRun.items.every((item: any) => item.status === 'failed' && item.errorCode === 'CREDENTIAL_REVOKED')).toBe(true)
  })

  it('cancel sends nothing more and releases the queued units; at most three runs per hearing', async () => {
    const { setup, runId } = await unsealedHearing()
    const userBefore = await bucket(`user:${OWNER}`)
    const started = await startGrader(setup, runId, 'openai')
    const graderRunId = started.json.data.graderRunId
    expect((await startGrader(setup, runId, 'openai')).status).toBe(409) // one in progress at a time
    expect((await h.request('POST', `/runs/${runId}/special-master/${graderRunId}/cancel`, { as: OWNER, body: {} })).status).toBe(200)
    const callsBefore = h.providerCalls.length
    await h.drainJobs()
    expect(h.providerCalls.length).toBe(callsBefore)
    expect(await bucket(`user:${OWNER}`)).toBe(userBefore)

    await fresh()
  })
})

async function fresh() {
  await h.dispose()
  h = await createHarness({ env: { MAX_DAILY_CALLS_PER_USER: '100', MAX_DAILY_CALLS_GLOBAL: '200' } })
}

describe('limits', () => {
  it('allows at most three special-master runs per hearing', async () => {
    await fresh()
    const { setup, runId } = await unsealedHearing()
    for (let i = 0; i < 3; i++) {
      expect((await startGrader(setup, runId)).status).toBe(202)
      await h.drainJobs()
    }
    const fourth = await startGrader(setup, runId)
    expect(fourth.status).toBe(409)
    expect(fourth.json.error.message).toMatch(/at most 3/)
  })
})

describe('security review fixes', () => {
  it('deleting the case stops a special-master run and refunds its queued units', async () => {
    const { setup, runId } = await unsealedHearing()
    const before = await bucket(`user:${OWNER}`)
    expect((await startGrader(setup, runId)).status).toBe(202)
    expect(await bucket(`user:${OWNER}`)).toBe(before + 10)
    const evaluation = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    expect((await h.request('DELETE', `/evaluations/${setup.evaluationId}`, { as: OWNER, ifMatch: evaluation.revision, body: { confirmTitle: evaluation.title } })).status).toBe(202)
    expect(await bucket(`user:${OWNER}`)).toBe(before)
    const callsBefore = h.providerCalls.length
    await h.drainJobs()
    expect(h.providerCalls.length).toBe(callsBefore)
    const graderRun = await h.db.prepare('SELECT status FROM grader_runs').first<any>()
    expect(graderRun.status).toBe('canceled')
  })

  it('a juror learns nothing about the draft from starting a hearing, even with generation off', async () => {
    const { setup, runId } = await unsealedHearing()
    h.env.GENERATION_ENABLED = 'false'
    const res = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
      as: REVIEWER,
      body: { draftRevision: 1, credentialIdsByProvider: {}, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
    })
    expect(res.status).toBe(403)
    expect(runId).toBeTruthy()
  })
})
