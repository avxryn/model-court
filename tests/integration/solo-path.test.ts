/**
 * The solo-judge path: deliberation opens by itself once every answer is in,
 * and a judge with no jury files and unseals in one step. With a jury, the
 * separate file and unseal steps are unchanged.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anthropicOk, createHarness, openAiOk, OWNER, REVIEWER, setupOwner, startRun, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

async function runView(runId: string) {
  return (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
}

async function completeRun(stub?: Parameters<Harness['setProvider']>[0]) {
  const setup = await setupOwner(h)
  if (stub) h.setProvider(stub)
  const runId = (await startRun(h, setup)).json.data.runId as string
  await h.drainJobs()
  return runId
}

async function auditRows(runId: string, eventType: string) {
  return (
    await h.db.prepare('SELECT actor_user_id, metadata_json FROM audit_events WHERE run_id = ? AND event_type = ? ORDER BY created_at').bind(runId, eventType).all<{ actor_user_id: string | null; metadata_json: string }>()
  ).results.map((row) => ({ actor: row.actor_user_id, metadata: JSON.parse(row.metadata_json) as Record<string, unknown> }))
}

function fullRatings(review: any) {
  return review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 1, grounding: 2, note: '', suspectedIdentityClue: false })))
}

/** Save complete ratings for `user` and return the session revision to file with. */
async function scoreAll(runId: string, user: string): Promise<number> {
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: user })).json.data
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: user, ifMatch: review.sessionRevision, body: { ratings: fullRatings(review) } })
  expect(saved.status).toBe(200)
  return saved.json.data.sessionRevision
}

async function summon(runId: string): Promise<string> {
  const res = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  expect(res.status).toBe(201)
  return new URL(res.json.data.url).hash.replace('#token=', '')
}

describe('deliberation opens automatically', () => {
  it('when the last answer arrives, with an automatic audit event and the judge’s session', async () => {
    const runId = await completeRun()
    const view = await runView(runId)
    expect(view.status).toBe('reviewing')
    expect(view.review.openedAt).not.toBeNull()
    expect(view.review.ownerSessionId).toEqual(expect.any(String))
    expect(view.eligibility).toMatchObject({ frozen: true, excludedCaseKeys: [] })
    expect(await auditRows(runId, 'review.open')).toEqual([{ actor: null, metadata: { eligible: 5, excluded: 0, automatic: true } }])
    // The judge's worksheet is ready at once.
    const review = await h.request('GET', `/runs/${runId}/review`, { as: OWNER })
    expect(review.status).toBe(200)
    expect(review.json.data).toMatchObject({ contextType: 'owner', sessionStatus: 'draft', runStatus: 'reviewing' })
    // Nothing left to open by hand.
    const manual = await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: false } })
    expect(manual.status).toBe(409)
    // A notice went out for the transition.
    expect(h.notices.some((n) => n.runId === runId && n.recipientUserId === OWNER)).toBe(true)
  })

  it('not while any answer failed: the judge decides, and the manual opening is recorded with its actor', async () => {
    let first = true
    const runId = await completeRun(async (call) => {
      if (first && call.url.includes('openai')) {
        first = false
        return new Response('{}', { status: 500 })
      }
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    const view = await runView(runId)
    expect(view.status).toBe('ready')
    expect(view.eligibility.excludedCaseKeys).toHaveLength(1)
    expect(await auditRows(runId, 'review.open')).toEqual([])
    const opened = await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })
    expect(opened.status).toBe(200)
    expect(await auditRows(runId, 'review.open')).toEqual([{ actor: OWNER, metadata: { eligible: 4, excluded: 1, automatic: false } }])
  })

  it('after a retry fills the last gap', async () => {
    let first = true
    const runId = await completeRun(async (call) => {
      if (first && call.url.includes('openai')) {
        first = false
        return new Response('{}', { status: 500 })
      }
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    let view = await runView(runId)
    const failed = view.generations.find((g: any) => g.status === 'failed')
    expect((await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: view.revision, body: { generationIds: [failed.id], acknowledgePossiblePriorCharge: true } })).status).toBe(202)
    await h.drainJobs()
    view = await runView(runId)
    expect(view.status).toBe('reviewing')
    expect(await auditRows(runId, 'review.open')).toEqual([{ actor: null, metadata: { eligible: 5, excluded: 0, automatic: true } }])
  })

  it('not for a canceled hearing', async () => {
    const setup = await setupOwner(h)
    const runId = (await startRun(h, setup)).json.data.runId as string
    const view = await runView(runId)
    expect((await h.request('POST', `/runs/${runId}/cancel`, { as: OWNER, ifMatch: view.revision, body: {} })).status).toBe(200)
    await h.drainJobs()
    expect((await runView(runId)).status).toBe('canceled')
    expect(await auditRows(runId, 'review.open')).toEqual([])
  })
})

describe('file and unseal for a judge with no jury', () => {
  it('files the judge’s worksheet and unseals in one commit', async () => {
    const runId = await completeRun()
    const revision = await scoreAll(runId, OWNER)
    const res = await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: revision, body: {} })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ runId, status: 'revealed', sessionRevision: revision + 1 })

    const view = await runView(runId)
    expect(view.status).toBe('revealed')
    expect(view.review.participants).toEqual([expect.objectContaining({ contextType: 'owner', status: 'submitted' })])
    const run = await h.db.prepare('SELECT reveal_cohort_json FROM runs WHERE id = ?').bind(runId).first<{ reveal_cohort_json: string }>()
    expect(JSON.parse(run!.reveal_cohort_json)).toEqual([view.review.ownerSessionId])
    expect(await auditRows(runId, 'review.submit')).toEqual([{ actor: OWNER, metadata: { withUnseal: true } }])
    expect(await auditRows(runId, 'run.reveal')).toEqual([{ actor: OWNER, metadata: { pendingClosed: 0, withFiling: true } }])

    const results = await h.request('GET', `/runs/${runId}/results`, { as: OWNER })
    expect(results.status).toBe(200)
    expect(results.json.data.cohorts.owner.byConfiguration).not.toBeNull()
    expect(results.json.data.cohorts.invited.byConfiguration).toBeNull()
  })

  it('replays the same request without a second commit', async () => {
    const runId = await completeRun()
    const revision = await scoreAll(runId, OWNER)
    const key = crypto.randomUUID()
    const first = await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: revision, body: {}, idempotencyKey: key })
    const again = await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: revision, body: {}, idempotencyKey: key })
    expect(first.status).toBe(200)
    expect(again.status).toBe(200)
    expect(again.json.data).toEqual(first.json.data)
    expect(await auditRows(runId, 'run.reveal')).toHaveLength(1)
  })

  it('refuses an incomplete worksheet and leaves everything open', async () => {
    const runId = await completeRun()
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    const res = await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: review.sessionRevision, body: {} })
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('INCOMPLETE_REVIEW')
    expect((await runView(runId)).status).toBe('reviewing')
  })
})

describe('with a jury, filing and unsealing stay separate', () => {
  it('refuses file-and-unseal while a juror holds a seat, then the usual steps work', async () => {
    const runId = await completeRun()
    const token = await summon(runId)
    expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
    const revision = await scoreAll(runId, OWNER)

    const refused = await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: revision, body: {} })
    expect(refused.status).toBe(409)
    expect(refused.json.error.details).toMatchObject({ juryPresent: true })
    // Nothing was filed or unsealed.
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    expect(review.sessionStatus).toBe('draft')
    expect((await runView(runId)).status).toBe('reviewing')

    expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: OWNER, ifMatch: revision, body: {} })).status).toBe(200)
    const view = await runView(runId)
    expect(view.status).toBe('reviewing')
    expect(view.review).toMatchObject({ submittedCount: 1, pendingCount: 1 })
    const revealed = await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } })
    expect(revealed.status).toBe(200)
  })

  it('refuses file-and-unseal while an unused summons is out', async () => {
    const runId = await completeRun()
    await summon(runId)
    const revision = await scoreAll(runId, OWNER)
    const refused = await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: revision, body: {} })
    expect(refused.status).toBe(409)
    expect(refused.json.error.details).toMatchObject({ juryPresent: true })
  })

  it('allows it once the only summons was revoked', async () => {
    const runId = await completeRun()
    await summon(runId)
    const inviteId = (await runView(runId)).review.invites[0].id
    expect((await h.request('DELETE', `/runs/${runId}/invites/${inviteId}`, { as: OWNER })).status).toBe(204)
    const revision = await scoreAll(runId, OWNER)
    expect((await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: OWNER, ifMatch: revision, body: {} })).status).toBe(200)
  })

  it('is the judge’s alone: a juror cannot use it', async () => {
    const runId = await completeRun()
    const token = await summon(runId)
    expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
    const revision = await scoreAll(runId, REVIEWER)
    const res = await h.request('POST', `/runs/${runId}/review/file-and-unseal`, { as: REVIEWER, ifMatch: revision, body: {} })
    expect(res.status).toBe(403)
    expect((await runView(runId)).status).toBe('reviewing')
  })
})
