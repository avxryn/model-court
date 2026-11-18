import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMaintenance } from '../../src/server/services/maintenance'
import { anthropicOk, createHarness, openAiOk, OTHER, OWNER, REVIEWER, setupOwner, startRun, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const SECOND = 'user_reviewer_4'

async function readyRun(stub?: Parameters<Harness['setProvider']>[0]) {
  const setup = await setupOwner(h)
  if (stub) h.setProvider(stub)
  const runId = (await startRun(h, setup)).json.data.runId as string
  await h.drainJobs()
  return { setup, runId }
}

async function runView(runId: string) {
  return (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
}

async function openAndInvite(runId: string) {
  const view = await runView(runId)
  const opened = await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })
  expect(opened.status).toBe(200)
  return opened.json.data
}

async function invite(runId: string): Promise<string> {
  const res = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  expect(res.status).toBe(201)
  return new URL(res.json.data.url).hash.replace('#token=', '')
}

function fullRatings(review: any, score: 0 | 1 | 2 = 2) {
  return review.cases.flatMap((c: any) =>
    c.responses.map((r: any) => ({ responseId: r.responseId, correctness: score, completeness: score, grounding: score, note: score === 0 ? 'Contradicts the reference policy.' : '', suspectedIdentityClue: false })),
  )
}

async function reviewAndSubmit(runId: string, user: string, score: 0 | 1 | 2 = 2) {
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: user })).json.data
  const saved = await h.request('PUT', `/runs/${runId}/review`, { as: user, ifMatch: review.sessionRevision, body: { ratings: fullRatings(review, score) } })
  expect(saved.status).toBe(200)
  const submitted = await h.request('POST', `/runs/${runId}/review/submit`, { as: user, ifMatch: saved.json.data.sessionRevision, body: {} })
  expect(submitted.status).toBe(200)
  return review
}

describe('T08 open review freezes eligible cases', () => {
  it('refuses to open with zero common cases and excludes incomplete cases with acknowledgment', async () => {
    const { runId } = await readyRun(async (call) => (call.url.includes('openai') ? new Response('{}', { status: 500 }) : anthropicOk()))
    const view = await runView(runId)
    const res = await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })
    expect(res.status).toBe(409)
    expect(res.json.error.message).toMatch(/nothing comparable/)
  })

  it('requires acknowledgment for excluded cases and blocks late retries', async () => {
    let first = true
    const { runId } = await readyRun(async (call) => {
      if (call.url.includes('openai') && first) {
        first = false
        return new Response('{}', { status: 500 })
      }
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    const view = await runView(runId)
    const unacked = await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: false } })
    expect(unacked.status).toBe(409)
    const opened = await openAndInvite(runId)
    expect(opened).toMatchObject({ eligibleCaseCount: 4, excludedCaseCount: 1 })
    const failed = view.generations.find((g: any) => g.status === 'failed')
    const retry = await h.request('POST', `/runs/${runId}/retries`, { as: OWNER, ifMatch: opened.revision, body: { generationIds: [failed.id], acknowledgePossiblePriorCharge: true } })
    expect(retry.status).toBe(409)
  })
})

describe('T09 invitations', () => {
  it('binds a single-use link to the first signed-in redeemer', async () => {
    const { runId } = await readyRun()
    await openAndInvite(runId)
    const token = await invite(runId)
    expect((await h.db.prepare('SELECT token_hash FROM invites').first<any>()).token_hash).not.toContain(token)
    expect(JSON.stringify((await h.db.prepare('SELECT * FROM command_receipts').all()).results)).not.toContain(token)
    expect((await h.request('POST', '/invites/redeem', { as: OWNER, body: { token } })).status).toBe(409) // owner cannot redeem
    const redeemed = await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })
    expect(redeemed.status).toBe(200)
    expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).json.data.sessionId).toBe(redeemed.json.data.sessionId)
    const replayByOther = await h.request('POST', '/invites/redeem', { as: OTHER, body: { token } })
    expect(replayByOther.status).toBe(409)
    expect(replayByOther.json.error.code).toBe('INVITE_UNAVAILABLE')
    expect((await h.request('GET', `/runs/${runId}/review`, { as: OTHER })).status).toBe(404)
  })

  it('rejects expired, revoked, and unknown tokens identically and enforces three slots', async () => {
    const { runId } = await readyRun()
    await openAndInvite(runId)
    const tokens = [await invite(runId), await invite(runId), await invite(runId)]
    expect((await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })).status).toBe(409) // 4th slot
    const invites = (await runView(runId)).review.invites
    expect((await h.request('DELETE', `/runs/${runId}/invites/${invites[0].id}`, { as: OWNER })).status).toBe(204)
    const revoked = await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: tokens[0] } })
    const unknown = await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: 'A'.repeat(43) } })
    h.advance(25 * 60 * 60 * 1000)
    const expired = await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: tokens[1] } })
    for (const res of [revoked, unknown, expired]) {
      expect(res.status).toBe(409)
      expect(res.json.error).toEqual(unknown.json.error)
    }
  })

  it('a lost invite response replays as a reissue marker without a new slot', async () => {
    const { runId } = await readyRun()
    await openAndInvite(runId)
    const key = crypto.randomUUID()
    const first = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, idempotencyKey: key, body: {} })
    const replay = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, idempotencyKey: key, body: {} })
    expect(replay.json.data).toEqual({ inviteId: first.json.data.inviteId, url: null, expiresAt: first.json.data.expiresAt, requiresReissue: true })
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM invites').first<any>()).n).toBe(1)
  })
})

describe('T10 blinding', () => {
  it('never exposes provider/configuration identity or peer ratings to an invited reviewer before reveal', async () => {
    const { runId, setup } = await readyRun(async (call) => (call.url.includes('openai') ? openAiOk('OpenAI style answer') : anthropicOk('Anthropic style answer')))
    await openAndInvite(runId)
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    await reviewAndSubmit(runId, OWNER, 1) // owner's ratings must stay invisible

    const payloads = [
      (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).text,
      (await h.request('GET', `/runs/${runId}`, { as: REVIEWER })).text,
      (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: REVIEWER })).text,
      (await h.request('GET', '/evaluations', { as: REVIEWER })).text,
      (await h.request('GET', `/runs/${runId}/results`, { as: REVIEWER })).text,
      JSON.stringify(h.notices.filter((n) => n.recipientUserId === REVIEWER)),
      JSON.stringify(h.jobs),
    ]
    const generationIds = (await h.db.prepare('SELECT id FROM generations').all<any>()).results.map((r) => r.id)
    const attemptIds = (await h.db.prepare('SELECT id FROM generation_attempts').all<any>()).results.map((r) => r.id)
    const configKeys = setup.draft.configurations.map((c: any) => c.key)
    const sentinels = ['gpt-6-luna', 'claude-haiku-5-5', 'openai', 'anthropic', 'Anthropic Claude', 'GPT-6', 'Candidate 1', 'Candidate 2', 'req_openai_test', 'snapshotHash', 'systemPrompt', ...generationIds, ...attemptIds, ...configKeys, setup.openaiKeyId]
    for (const payload of payloads) {
      for (const sentinel of sentinels) expect(payload, `leaked ${sentinel}`).not.toContain(sentinel)
    }
    // The generated text itself is shown faithfully (it may contain style clues).
    expect(payloads[0]).toContain('OpenAI style answer')
    // No peer ratings before reveal.
    const review = JSON.parse(payloads[0]).data
    expect(review.ratings).toEqual([])
    expect((await h.request('GET', `/runs/${runId}/results`, { as: REVIEWER })).status).toBe(409)
  })

  it('keeps a stable per-session order across reloads, with session-specific response ids', async () => {
    const { runId } = await readyRun()
    await openAndInvite(runId)
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    const a = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    const b = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    expect(b.cases).toEqual(a.cases)
    const owner = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    const ownerIds = owner.cases.flatMap((c: any) => c.responses.map((r: any) => r.responseId))
    const reviewerIds = a.cases.flatMap((c: any) => c.responses.map((r: any) => r.responseId))
    expect(ownerIds.some((id: string) => reviewerIds.includes(id))).toBe(false)
  })
})

describe('T11/T12 ratings', () => {
  it('saves partial drafts, detects two-tab conflicts, and rejects forged response ids', async () => {
    const { runId } = await readyRun()
    await openAndInvite(runId)
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    const partial = [{ ...fullRatings(review)[0], grounding: null }]
    const saved = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings: partial } })
    expect(saved.status).toBe(200)
    const reload = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    expect(reload.ratings).toEqual(partial)
    const staleTab = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings: [] } })
    expect(staleTab.status).toBe(409)
    expect((await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data.ratings).toEqual(partial)
    const forged = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: reload.sessionRevision, body: { ratings: [{ ...partial[0], responseId: crypto.randomUUID() }] } })
    expect(forged.status).toBe(422)
  })

  it('rejects incomplete submission, accepts one complete submission, replays it, and freezes ratings', async () => {
    const { runId } = await readyRun()
    await openAndInvite(runId)
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
    const incomplete = await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: review.sessionRevision, body: {} })
    expect(incomplete.json.error.code).toBe('INCOMPLETE_REVIEW')
    const zeroNoNote = fullRatings(review, 0).map((r: any) => ({ ...r, note: '' }))
    const saved0 = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings: zeroNoNote } })
    expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: saved0.json.data.sessionRevision, body: {} })).json.error.code).toBe('INCOMPLETE_REVIEW')
    const saved = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: saved0.json.data.sessionRevision, body: { ratings: fullRatings(review) } })
    const key = crypto.randomUUID()
    const submit = await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: saved.json.data.sessionRevision, idempotencyKey: key, body: {} })
    expect(submit.status).toBe(200)
    const again = await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: saved.json.data.sessionRevision, idempotencyKey: key, body: {} })
    expect(again.json.data).toEqual(submit.json.data)
    const edit = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: submit.json.data.sessionRevision, body: { ratings: [] } })
    expect(edit.status).toBe(409)
    await expect(h.db.prepare(`UPDATE review_sessions SET ratings_json = '[]' WHERE status = 'submitted'`).run()).rejects.toThrow(/IMMUTABLE/)
  })

  it('an owner cannot remove a submitted review, but can remove an unsubmitted one', async () => {
    const { runId } = await readyRun()
    await openAndInvite(runId)
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    await h.request('POST', '/invites/redeem', { as: SECOND, body: { token: await invite(runId) } })
    await reviewAndSubmit(runId, REVIEWER)
    const participants = (await runView(runId)).review.participants
    const submitted = participants.find((p: any) => p.status === 'submitted')
    const draft = participants.find((p: any) => p.status === 'draft' && p.contextType === 'invited')
    expect((await h.request('DELETE', `/runs/${runId}/reviewers/${submitted.id}`, { as: OWNER })).status).toBe(409)
    expect((await h.request('DELETE', `/runs/${runId}/reviewers/${draft.id}`, { as: OWNER })).status).toBe(204)
    expect((await h.request('GET', `/runs/${runId}/review`, { as: SECOND })).status).toBe(404)
  })
})

describe('T13 reveal races', () => {
  it('requires one submission and the exact pending count', async () => {
    const { runId } = await readyRun()
    await openAndInvite(runId)
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    let view = await runView(runId)
    expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: view.review.pendingCount } })).status).toBe(409)
    await reviewAndSubmit(runId, REVIEWER)
    view = await runView(runId)
    expect(view.review.pendingCount).toBe(1) // owner's own draft session
    const wrong = await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 0 } })
    expect(wrong.json.error.details).toMatchObject({ pendingCount: 1, submittedCount: 1 })
    expect((await h.request('POST', `/runs/${runId}/reveal`, { as: REVIEWER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } })).status).toBe(403)
    expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } })).status).toBe(200)
    // Late submission is refused and the unsubmitted owner draft is excluded.
    const ownerReview = (await h.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
    expect(ownerReview.closedNotice).toMatch(/not included/)
    expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: OWNER, ifMatch: ownerReview.sessionRevision, body: {} })).status).toBe(409)
  })

  it('20 submit-vs-reveal races: commit order decides membership; no late review enters the cohort', async () => {
    for (let i = 0; i < 20; i++) {
      const local = await createHarness()
      try {
        const setup = await setupOwner(local)
        const runId = (await startRun(local, setup)).json.data.runId
        await local.drainJobs()
        let view = (await local.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
        view = (await local.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })).json.data
        const tokenA = new URL((await local.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })).json.data.url).hash.slice(7)
        await local.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: tokenA } })
        // Owner submits so reveal has one submission; the reviewer races reveal.
        for (const user of [OWNER, REVIEWER]) {
          const review = (await local.request('GET', `/runs/${runId}/review`, { as: user })).json.data
          await local.request('PUT', `/runs/${runId}/review`, { as: user, ifMatch: review.sessionRevision, body: { ratings: fullRatings(review) } })
        }
        await (async () => {
          const r = (await local.request('GET', `/runs/${runId}/review`, { as: OWNER })).json.data
          await local.request('POST', `/runs/${runId}/review/submit`, { as: OWNER, ifMatch: r.sessionRevision, body: {} })
        })()
        const reviewer = (await local.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
        view = (await local.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
        const [submit, revealRes] = await Promise.all([
          local.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: reviewer.sessionRevision, body: {} }),
          local.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } }),
        ])
        const cohort = JSON.parse((await local.db.prepare('SELECT reveal_cohort_json FROM runs').first<any>()).reveal_cohort_json ?? '[]')
        const reviewerSubmitted = (await local.db.prepare(`SELECT status FROM review_sessions WHERE reviewer_user_id = ?`).bind(REVIEWER).first<any>()).status === 'submitted'
        if (revealRes.status === 200) {
          // Reveal acknowledged one pending review, so it committed before the submission.
          expect(cohort).toHaveLength(1)
          expect(reviewerSubmitted).toBe(false)
          expect(submit.status).toBe(409)
        } else {
          // Submission committed first; reveal's pending-count guard detected the change.
          expect(revealRes.status).toBe(409)
          expect(submit.status).toBe(200)
          expect(reviewerSubmitted).toBe(true)
        }
      } finally {
        await local.dispose()
      }
    }
  }, 240_000)
})

describe('T14/T15 results and verdicts', () => {
  it('reveals mappings, separates cohorts, reports coverage, and appends verdict revisions', async () => {
    let failOnce = true
    const { runId } = await readyRun(async (call) => {
      if (call.url.includes('anthropic') && failOnce) {
        failOnce = false
        return new Response('{}', { status: 500 })
      }
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    await openAndInvite(runId)
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    await h.request('POST', '/invites/redeem', { as: SECOND, body: { token: await invite(runId) } })
    await reviewAndSubmit(runId, REVIEWER, 2)
    await reviewAndSubmit(runId, SECOND, 1)
    await reviewAndSubmit(runId, OWNER, 2)
    let view = await runView(runId)
    expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 0 } })).status).toBe(200)

    const results = (await h.request('GET', `/runs/${runId}/results`, { as: REVIEWER })).json.data
    expect(results.cohorts.invited.reviewerCount).toBe(2)
    expect(results.cohorts.owner.reviewerCount).toBe(1)
    expect(results.cohorts.invited.caseCount).toBe(4)
    const [a, b] = results.configurations.map((c: any) => c.key)
    expect(results.cohorts.invited.byConfiguration[a].overallMean).toBe(1.5)
    expect(results.cohorts.owner.byConfiguration[b].overallMean).toBe(2)
    expect(results.excludedCaseKeys).toHaveLength(1)
    const anthropicKey = results.configurations.find((c: any) => c.provider === 'anthropic').key
    expect(results.coverage[anthropicKey]).toMatchObject({ planned: 5, succeeded: 4, failed: 1 })
    expect(results.disagreements.length).toBeGreaterThan(0)
    expect(JSON.stringify(results)).not.toContain('sk-')
    expect(results.cases[0].judgments.every((j: any) => /^(Reviewer \d|Owner)/.test(j.reviewer))).toBe(true)

    expect((await h.request('POST', `/runs/${runId}/verdicts`, { as: REVIEWER, ifMatch: results.revision, body: { outcome: 'tie', rationale: 'x'.repeat(25), limitations: '' } })).status).toBe(403)
    const v1 = await h.request('POST', `/runs/${runId}/verdicts`, { as: OWNER, ifMatch: results.revision, body: { outcome: 'selected', selectedConfigurationKey: a, rationale: 'Candidate A grounded its answers better.', limitations: 'Four cases only.' } })
    expect(v1.status).toBe(201)
    const v2 = await h.request('POST', `/runs/${runId}/verdicts`, { as: OWNER, ifMatch: v1.json.data.revision, body: { outcome: 'inconclusive', rationale: 'On reflection the sample is too small to decide.', limitations: '' } })
    expect(v2.json.data.verdictRevision).toBe(2)
    const after = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(after.status).toBe('decided')
    expect(after.verdicts.map((v: any) => v.outcome)).toEqual(['selected', 'inconclusive'])
    view = await runView(runId)
    expect(view.status).toBe('decided')
  })
})

describe('T16/T20 notices and deletion', () => {
  it('publishes ID-only notices to participants', async () => {
    const { runId } = await readyRun()
    expect(h.notices.length).toBeGreaterThan(0)
    for (const notice of h.notices) expect(Object.keys(notice).sort()).toEqual(['evaluationId', 'recipientUserId', 'runId'])
    expect(h.notices.every((n) => n.runId === runId && n.recipientUserId === OWNER)).toBe(true)
  })

  it('tombstones immediately, fences late output, and purges within cleanup', async () => {
    const setup = await setupOwner(h)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    h.setProvider(async (call) => {
      await gate
      return call.url.includes('openai') ? openAiOk() : anthropicOk()
    })
    await startRun(h, setup)
    const { handleGenerationJob } = await import('../../src/server/services/generation')
    const inflight = handleGenerationJob(h.deps, h.jobs.shift()!, new AbortController().signal, 'req')
    while (h.providerCalls.length === 0) await new Promise((r) => setTimeout(r, 10))
    const evaluation = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    expect((await h.request('DELETE', `/evaluations/${setup.evaluationId}`, { as: OWNER, ifMatch: evaluation.revision, body: { confirmTitle: 'wrong' } })).status).toBe(422)
    expect((await h.request('DELETE', `/evaluations/${setup.evaluationId}`, { as: OWNER, ifMatch: evaluation.revision, body: { confirmTitle: evaluation.title } })).status).toBe(202)
    expect((await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).status).toBe(404)
    release()
    expect(await inflight).toBe('stale')
    expect((await h.db.prepare(`SELECT allocated_units FROM budget_buckets WHERE subject = ?`).bind(`user:${OWNER}`).first<any>()).allocated_units).toBe(1)
    h.advance(121_000)
    const report = await runMaintenance(h.deps)
    expect(report.evaluationsPurged).toBe(1)
    for (const table of ['evaluations', 'runs', 'generations', 'generation_attempts', 'outbox', 'review_sessions', 'command_receipts']) {
      const n = (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'command_receipts' ? "operation LIKE 'run.%'" : '1'}`).first<any>()).n
      expect(n, table).toBe(0)
    }
    // Keys are account-wide: deleting an evaluation does not remove them.
    expect((await h.request('GET', '/credentials', { as: OWNER })).json.data.items).toHaveLength(2)
  })
})

describe('review fix: reviewer evaluation list shows only joined runs', () => {
  it('does not reveal the status of a later run the reviewer was not invited to', async () => {
    const { runId, setup } = await readyRun()
    await openAndInvite(runId)
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    // The judge's row counts seated and filed jurors, so the docket can say "Waiting on jurors" instead of "Unseal".
    const before = (await h.request('GET', '/evaluations', { as: OWNER })).json.data.items
    expect(before[0].jurors).toEqual({ joined: 1, filed: 0 })
    expect(before[0].viewerFiled).toBe(false)
    expect((await h.request('GET', '/evaluations', { as: REVIEWER })).json.data.items[0].viewerFiled).toBe(false)
    await reviewAndSubmit(runId, REVIEWER)
    expect((await h.request('GET', '/evaluations', { as: OWNER })).json.data.items[0].jurors).toEqual({ joined: 1, filed: 1 })
    const view = await runView(runId)
    await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } })
    h.advance(61_000)
    expect((await startRun(h, setup)).status).toBe(202) // second run, reviewer not invited
    const list = (await h.request('GET', '/evaluations', { as: REVIEWER })).json.data.items
    expect(list).toHaveLength(1)
    expect(list[0].latestRunStatus).toBe('revealed')
    // The juror's link points at the hearing they sat on, never the later one they were not invited to.
    expect(list[0].latestRunId).toBe(runId)
    // A juror's row says only whether they filed, never how other jurors are doing.
    expect(list[0].viewerFiled).toBe(true)
    expect(list[0].jurors).toBeNull()
    const owners = (await h.request('GET', '/evaluations', { as: OWNER })).json.data.items
    expect(owners[0].latestRunStatus).toBe('generating')
    expect(owners[0].latestRunId).toEqual(expect.any(String))
    expect(owners[0].latestRunId).not.toBe(runId)
    expect(owners[0].jurors).toEqual({ joined: 0, filed: 0 })
  })

  it('treats a non-numeric limit as the default instead of failing', async () => {
    await setupOwner(h)
    const res = await h.request('GET', '/evaluations?limit=abc', { as: OWNER })
    expect(res.status).toBe(200)
    expect(res.json.data.items).toHaveLength(1)
  })
})
