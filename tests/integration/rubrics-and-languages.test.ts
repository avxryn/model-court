/**
 * Phase 3 (D-35, D-36): a hearing records the rubric version chosen in the
 * draft, jurors see that version, and the record breaks findings down by
 * question language. Drafts without the new fields behave exactly as before.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, OWNER, REVIEWER, setupOwner, startRun, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

async function setupTagged(rubricVersion: string | undefined, languages: Array<string | undefined>) {
  const setup = await setupOwner(h)
  const { schemaVersion: _v, ...draft } = setup.draft
  const body: Record<string, unknown> = {
    ...draft,
    ...(rubricVersion ? { rubricVersion } : {}),
    cases: draft.cases.map((c: Record<string, unknown>, i: number) => ({ ...c, ...(languages[i] ? { language: languages[i] } : {}) })),
  }
  const saved = await h.request('PUT', `/evaluations/${setup.evaluationId}/draft`, { as: OWNER, ifMatch: 1, body })
  return { setup, saved, body }
}

async function hearing(rubricVersion: string | undefined, languages: Array<string | undefined>) {
  const { setup, saved } = await setupTagged(rubricVersion, languages)
  expect(saved.status).toBe(200)
  const started = await h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: OWNER,
    body: { draftRevision: saved.json.data.revision, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
  expect(started.status).toBe(202)
  const runId = started.json.data.runId as string
  await h.drainJobs()
  let view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
  expect((await h.request('POST', `/runs/${runId}/open-review`, { as: OWNER, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })).status).toBe(200)
  const invite = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  const token = new URL(invite.json.data.url).hash.replace('#token=', '')
  expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(200)
  const review = (await h.request('GET', `/runs/${runId}/review`, { as: REVIEWER })).json.data
  const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: r.label === 'A' ? 2 : 1, grounding: 2, note: '', suspectedIdentityClue: false })))
  const saveRatings = await h.request('PUT', `/runs/${runId}/review`, { as: REVIEWER, ifMatch: review.sessionRevision, body: { ratings } })
  expect((await h.request('POST', `/runs/${runId}/review/submit`, { as: REVIEWER, ifMatch: saveRatings.json.data.sessionRevision, body: {} })).status).toBe(200)
  view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
  expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } })).status).toBe(200)
  return { runId, review }
}

describe('rubric versions', () => {
  it('records the chosen rubric in the snapshot, the juror view, the record, and the export', async () => {
    const { runId, review } = await hearing('safety-v1', [])
    expect(review.rubricVersion).toBe('safety-v1')
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.rubricVersion).toBe('safety-v1')
    const exported = (await h.request('GET', `/runs/${runId}/export?format=json`, { as: OWNER })).json.data
    expect(JSON.stringify(exported)).toContain('safety-v1')
    const snapshot = JSON.parse((await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(runId).first<any>()).snapshot_json)
    expect(snapshot.rubricVersion).toBe('safety-v1')
  })

  it('a draft without a rubric keeps the default and an unchanged snapshot shape', async () => {
    const setup = await setupOwner(h)
    const started = await startRun(h, setup)
    const snapshot = JSON.parse((await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(started.json.data.runId).first<any>()).snapshot_json)
    expect(snapshot.rubricVersion).toBe('reference-qa-v1')
    expect(snapshot.cases.every((c: Record<string, unknown>) => !('language' in c))).toBe(true)
  })

  it('rejects an unknown rubric version and a blank language tag', async () => {
    expect((await setupTagged('made-up-v9', [])).saved.status).toBe(422)
    h = (await h.dispose(), await createHarness())
    expect((await setupTagged(undefined, ['   '])).saved.status).toBe(422)
  })
})

describe('findings by language', () => {
  it('groups eligible questions by tag, untagged last, each scored on its own questions', async () => {
    const { runId } = await hearing(undefined, ['en', 'en', 'es', 'es', undefined])
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.byLanguage.map((g: any) => [g.language, g.caseKeys.length])).toEqual([
      ['en', 2],
      ['es', 2],
      [null, 1],
    ])
    for (const group of results.byLanguage) {
      expect(group.invited.caseCount).toBe(group.caseKeys.length)
      expect(group.invited.reviewerCount).toBe(1)
    }
    expect(results.cases.map((c: any) => c.language)).toEqual(['en', 'en', 'es', 'es', null])
  })

  it('reports no breakdown with fewer than two languages', async () => {
    const { runId } = await hearing(undefined, ['en', 'en', undefined, undefined, undefined])
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    expect(results.byLanguage).toEqual([])
  })
})
