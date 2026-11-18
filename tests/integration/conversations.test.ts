/**
 * Phase 5a (D-39): next-turn evaluation. A question may carry the conversation
 * so far; every party receives the same history and writes the next reply.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MODEL_ROUTES } from '../../src/domain/registry'
import { createHarness, openDeliberation, OWNER, setupOwner, startRun, type Harness, type HarnessOptions } from './harness'

let h: Harness
async function fresh(options?: HarnessOptions) {
  await h?.dispose()
  h = await createHarness(options)
}
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const HISTORY = [
  { role: 'user', content: 'HISTORY-USER-TURN I bought a jacket 12 days ago.' },
  { role: 'assistant', content: 'HISTORY-ASSISTANT-TURN Regular items can be returned within 30 days with a receipt.' },
]

async function setupWithHistory() {
  const setup = await setupOwner(h)
  const { schemaVersion: _v, ...draft } = setup.draft
  const body = { ...draft, cases: draft.cases.map((c: any, i: number) => (i === 0 ? { ...c, messages: HISTORY } : c)) }
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body })
  expect(saved.status).toBe(200)
  return { setup, revision: saved.json.data.revision as number, firstCaseInput: draft.cases[0].input as string }
}

async function start(setup: Awaited<ReturnType<typeof setupOwner>>, revision: number) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: revision, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}

describe('next-turn hearings', () => {
  it('send the same history to every party as alternating turns, and record chat-v1', async () => {
    const { setup, revision, firstCaseInput } = await setupWithHistory()
    const started = await start(setup, revision)
    expect(started.status).toBe(202)
    await h.drainJobs()
    const withHistory = h.providerCalls.filter((call) => JSON.stringify(call.body).includes('HISTORY-USER-TURN'))
    expect(withHistory).toHaveLength(2)
    const openai = withHistory.find((call) => call.url.includes('openai'))!.body as any
    expect(openai.input.map((item: any) => item.role)).toEqual(['user', 'assistant', 'user'])
    expect(openai.input[1].content[0]).toEqual({ type: 'output_text', text: HISTORY[1].content })
    expect(openai.input[2].content[0].text).toBe(firstCaseInput)
    const anthropic = withHistory.find((call) => call.url.includes('anthropic'))!.body as any
    expect(anthropic.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(anthropic.messages[0].content).toContain('HISTORY-USER-TURN')
    // Questions without history still send one user message.
    const others = h.providerCalls.filter((call) => !JSON.stringify(call.body).includes('HISTORY-USER-TURN'))
    expect(others).toHaveLength(8)
    expect(others.every((call) => ((call.body as any).input ?? (call.body as any).messages).length === 1)).toBe(true)
    // Expected behavior (the jury instructions) is never sent.
    const runId = started.json.data.runId
    const snapshot = JSON.parse((await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(runId).first<any>()).snapshot_json)
    expect(snapshot.messageTemplateVersion).toBe('chat-v1')
    expect(snapshot.configurations.map((c: any) => c.adapterVersion)).toEqual(['openai-responses-v2', 'anthropic-messages-v2'])
    for (const call of h.providerCalls) expect(JSON.stringify(call.body)).not.toContain(snapshot.cases[0].expectedBehavior)
  })

  it('show jurors the shared history with the question', async () => {
    const { setup, revision } = await setupWithHistory()
    const runId = (await start(setup, revision)).json.data.runId
    await h.drainJobs()
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    await openDeliberation(h, runId)
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    const withHistory = review.cases.filter((c: any) => c.messages.length > 0)
    expect(withHistory).toHaveLength(1)
    expect(withHistory[0].messages).toEqual(HISTORY)
  })

  it('a draft without history keeps qa-v1 and single-message requests', async () => {
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId
    await h.drainJobs()
    const snapshot = JSON.parse((await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(runId).first<any>()).snapshot_json)
    expect(snapshot.messageTemplateVersion).toBe('qa-v1')
    expect(h.providerCalls.every((call) => ((call.body as any).input ?? (call.body as any).messages).length === 1)).toBe(true)
  })

  it('refuses a hearing with history until the routes pass a multi-message check', async () => {
    await fresh({ routes: MODEL_ROUTES.map((route) => ({ ...route, verifiedAt: '2026-11-16', multiTurnVerifiedAt: null })) })
    const { setup, revision } = await setupWithHistory()
    const refused = await start(setup, revision)
    expect(refused.status).toBe(422)
    expect(refused.json.error.code).toBe('UNSUPPORTED_CONFIGURATION')
    expect(h.jobs).toHaveLength(0)
  })
})
