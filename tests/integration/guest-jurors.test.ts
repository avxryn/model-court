/**
 * Phase 7 (D-41): accountless jurors. Re-proves pre-reveal blinding and access
 * control for the cookie path, as docs/design/accountless-jurors.md requires.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMaintenance } from '../../src/server/services/maintenance'
import { createHarness, openDeliberation, OTHER, OWNER, REVIEWER, setupOwner, startRun, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

const ORIGIN = 'https://model-court.test'

async function reviewingHearing() {
  const setup = await setupOwner(h)
  const runId = (await startRun(h, setup)).json.data.runId as string
  await h.drainJobs()
  const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
  await openDeliberation(h, runId)
  return { setup, runId }
}

async function invite(runId: string): Promise<string> {
  const res = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
  expect(res.status).toBe(201)
  return new URL(res.json.data.url).hash.replace('#token=', '')
}

async function joinAsGuest(runId: string, name = 'Dana', headers: Record<string, string> = { Origin: ORIGIN }) {
  const res = await h.request('POST', '/invites/redeem-as-guest', { headers, body: { token: await invite(runId), displayName: name } })
  const setCookie = res.headers.get('Set-Cookie') ?? ''
  const pair = setCookie.split(';')[0]
  return { res, setCookie, cookie: pair, resumeSecret: res.json?.data?.resumeSecret as string }
}

const asGuest = (cookie: string, extra: Record<string, string> = {}) => ({ headers: { Cookie: cookie, ...extra } })

function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.length ? keyPaths(value[0], `${prefix}[]`) : [`${prefix}[]`]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => [`${prefix}.${k}`, ...keyPaths(v, `${prefix}.${k}`)])
  return []
}

describe('joining and the cookie', () => {
  it('sets a host-only, HttpOnly, Secure, SameSite=Strict cookie and stores only hashes', async () => {
    const { runId } = await reviewingHearing()
    const { res, setCookie, cookie, resumeSecret } = await joinAsGuest(runId)
    expect(res.status).toBe(201)
    expect(setCookie).toMatch(new RegExp(`^__Host-mcj-${runId}=`))
    for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=1209600']) expect(setCookie).toContain(attribute)
    expect(setCookie).not.toContain('Domain=')
    const value = cookie.split('=')[1]
    expect(res.text).not.toContain(value)
    expect(resumeSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = JSON.stringify([...(await h.db.prepare('SELECT * FROM juror_principals').all()).results, ...(await h.db.prepare('SELECT * FROM juror_devices').all()).results])
    expect(stored).not.toContain(value.split('.')[1])
    expect(stored).not.toContain(resumeSecret)
    const audit = JSON.stringify((await h.db.prepare('SELECT * FROM audit_events').all()).results)
    expect(audit).not.toContain('Dana')
    expect(audit).not.toContain(resumeSecret)
    expect(JSON.stringify(h.logs)).not.toContain(resumeSecret)
  })

  it('refuses a cross-site or origin-less join, a bad name, and a second use of the link', async () => {
    const { runId } = await reviewingHearing()
    const first = await invite(runId)
    const tryJoin = (headers: Record<string, string>) => h.request('POST', '/invites/redeem-as-guest', { headers, body: { token: first, displayName: 'Dana' } })
    expect((await tryJoin({})).status).toBe(403)
    expect((await tryJoin({ Origin: 'https://evil.example' })).status).toBe(403)
    expect((await tryJoin({ 'Sec-Fetch-Site': 'same-origin' })).status).toBe(201)
    const token = await invite(runId)
    expect((await h.request('POST', '/invites/redeem-as-guest', { headers: { Origin: ORIGIN }, body: { token, displayName: '   ' } })).status).toBe(422)
    expect((await h.request('POST', '/invites/redeem-as-guest', { headers: { Origin: ORIGIN }, body: { token, displayName: 'Ok' } })).status).toBe(201)
    expect((await h.request('POST', '/invites/redeem-as-guest', { headers: { Origin: ORIGIN }, body: { token, displayName: 'Again' } })).status).toBe(409)
    expect((await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token } })).status).toBe(409)
  })

  it('counts guests against the same three seats as signed-in jurors', async () => {
    const { runId } = await reviewingHearing()
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    await joinAsGuest(runId, 'G1')
    await joinAsGuest(runId, 'G2')
    const fourth = await h.request('POST', `/runs/${runId}/invites`, { as: OWNER, body: {} })
    expect(fourth.status).toBe(409)
  })
})

describe('blinding and scope', () => {
  it('gives guests exactly the projections signed-in jurors get, with nothing identifying', async () => {
    const { setup, runId } = await reviewingHearing()
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    const { cookie } = await joinAsGuest(runId)
    for (const path of [`/runs/${runId}`, `/runs/${runId}/review`]) {
      const signedIn = await h.request('GET', path, { as: REVIEWER })
      const guest = await h.request('GET', path, asGuest(cookie))
      expect(guest.status).toBe(200)
      expect(keyPaths(guest.json.data).sort()).toEqual(keyPaths(signedIn.json.data).sort())
      const snapshot = JSON.parse((await h.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').bind(runId).first<any>()).snapshot_json)
      for (const c of snapshot.configurations) {
        expect(guest.text).not.toContain(c.label)
        expect(guest.text).not.toContain(c.modelId)
        expect(guest.text).not.toContain(c.key)
      }
      for (const leak of ['openai', 'anthropic', 'generationId', 'acceptedAttemptId', 'configurationKey', setup.openaiKeyId]) expect(guest.text).not.toContain(leak)
    }
  })

  it('reaches only its own hearing’s review routes', async () => {
    const { runId } = await reviewingHearing()
    const { cookie } = await joinAsGuest(runId)
    for (const [method, path] of [
      ['GET', '/evaluations'],
      ['GET', '/credentials'],
      ['GET', `/runs/${runId}/special-master`],
      ['GET', `/runs/${runId}/export?format=json`],
    ] as const) {
      expect((await h.request(method, path, asGuest(cookie))).status).toBe(401)
    }
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    expect((await h.request('POST', `/runs/${runId}/reveal`, { ...asGuest(cookie, { Origin: ORIGIN }), ifMatch: view.revision, body: { acknowledgePendingCount: 0 } })).status).toBe(401)
    // The same cookie value under another hearing's name is refused.
    const other = crypto.randomUUID()
    expect((await h.request('GET', `/runs/${other}`, asGuest(cookie.replace(runId, other)))).status).toBe(401)
    expect((await h.request('GET', `/runs/${runId}`, asGuest(cookie.replace(/=.*$/, '=deadbeef.nope')))).status).toBe(401)
  })

  it('never lets a token claim the guest namespace, and results stay sealed until reveal', async () => {
    const { runId } = await reviewingHearing()
    const { cookie } = await joinAsGuest(runId)
    const forged = await h.token('mcj_forged')
    expect((await h.request('GET', '/evaluations', { rawToken: forged })).status).toBe(401)
    expect((await h.request('GET', `/runs/${runId}/results`, asGuest(cookie))).status).toBe(409)
  })
})

describe('reviewing as a guest', () => {
  it('saves and files under CSRF rules, keeps one shuffle across devices, and is never notified by socket', async () => {
    const { runId } = await reviewingHearing()
    const { cookie, resumeSecret } = await joinAsGuest(runId)
    const review = (await h.request('GET', `/runs/${runId}/review`, asGuest(cookie))).json.data
    const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
    expect((await h.request('PUT', `/runs/${runId}/review`, { ...asGuest(cookie), ifMatch: review.sessionRevision, body: { ratings } })).status).toBe(403)
    expect((await h.request('PUT', `/runs/${runId}/review`, { ...asGuest(cookie, { Origin: 'https://evil.example' }), ifMatch: review.sessionRevision, body: { ratings } })).status).toBe(403)
    const saved = await h.request('PUT', `/runs/${runId}/review`, { ...asGuest(cookie, { 'Sec-Fetch-Site': 'same-origin' }), ifMatch: review.sessionRevision, body: { ratings } })
    expect(saved.status).toBe(200)

    const resumed = await h.request('POST', '/juror/resume', { headers: { Origin: ORIGIN }, body: { resume: resumeSecret } })
    expect(resumed.status).toBe(201)
    const second = (resumed.headers.get('Set-Cookie') ?? '').split(';')[0]
    const fromSecond = (await h.request('GET', `/runs/${runId}/review`, asGuest(second))).json.data
    expect(fromSecond.cases.map((c: any) => c.responses.map((r: any) => r.responseId))).toEqual(review.cases.map((c: any) => c.responses.map((r: any) => r.responseId)))

    expect((await h.request('POST', `/runs/${runId}/review/submit`, { ...asGuest(second, { Origin: ORIGIN }), ifMatch: saved.json.data.sessionRevision, body: {} })).status).toBe(200)
    expect(h.notices.every((notice: any) => !String(notice.recipientUserId).startsWith('mcj_'))).toBe(true)

    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    // The judge's own unfinished review is the one pending item.
    expect((await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 1 } })).status).toBe(200)
    expect((await h.request('GET', `/runs/${runId}/results`, asGuest(cookie))).status).toBe(200)
    // After the record is unsealed the resume link stops working.
    expect((await h.request('POST', '/juror/resume', { headers: { Origin: ORIGIN }, body: { resume: resumeSecret } })).status).toBe(409)
  })

  it('uses each resume link once and hands the new device the next one', async () => {
    const { runId } = await reviewingHearing()
    const { resumeSecret } = await joinAsGuest(runId)
    const resume = (secret: string, headers: Record<string, string> = {}) => h.request('POST', '/juror/resume', { headers: { Origin: ORIGIN, ...headers }, body: { resume: secret } })
    const first = await resume(resumeSecret)
    expect(first.status).toBe(201)
    expect(first.json.data.resumeSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await resume(resumeSecret)).status).toBe(409) // the old link is used up
    const second = await resume(first.json.data.resumeSecret)
    expect(second.status).toBe(201)
    expect((await resume(second.json.data.resumeSecret)).status).toBe(409) // a fourth device
  })

  it('rate-limits resume attempts per client address', async () => {
    const { runId } = await reviewingHearing()
    await joinAsGuest(runId)
    const junk = () => h.request('POST', '/juror/resume', { headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' }, body: { resume: 'x'.repeat(43) } })
    for (let i = 0; i < 5; i++) expect((await junk()).status).toBe(409)
    expect((await junk()).status).toBe(429)
    // Another address is unaffected: there is no shared global bucket.
    expect((await h.request('POST', '/juror/resume', { headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.8' }, body: { resume: 'x'.repeat(43) } })).status).toBe(409)
  })

  it('refuses a resume link that would move this browser into another juror’s seat', async () => {
    const { runId } = await reviewingHearing()
    const victim = await joinAsGuest(runId, 'Victor')
    const mallory = await joinAsGuest(runId, 'Mallory')
    const planted = await h.request('POST', '/juror/resume', { headers: { Origin: ORIGIN, Cookie: victim.cookie }, body: { resume: mallory.resumeSecret } })
    expect(planted.status).toBe(409)
    expect(planted.headers.get('Set-Cookie')).toBeNull()
    // Victor's own link still works for Victor.
    expect((await h.request('POST', '/juror/resume', { headers: { Origin: ORIGIN, Cookie: victim.cookie }, body: { resume: victim.resumeSecret } })).status).toBe(201)
  })

  it('expires a device after 14 days on the server, whatever the browser keeps', async () => {
    const { runId } = await reviewingHearing()
    const { cookie } = await joinAsGuest(runId)
    h.advance(14 * 24 * 60 * 60 * 1000 + 1)
    expect((await h.request('GET', `/runs/${runId}`, asGuest(cookie))).status).toBe(401)
  })
})

describe('seat integrity', () => {
  it('stops the judge or a seated juror from also taking a guest seat while signed in, and labels guests in the record', async () => {
    const { runId } = await reviewingHearing()
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    for (const user of [OWNER, REVIEWER]) {
      const res = await h.request('POST', '/invites/redeem-as-guest', { as: user, headers: { Origin: ORIGIN }, body: { token: await invite(runId), displayName: 'Sock puppet' } })
      expect(res.status).toBe(409)
      await h.request('DELETE', `/runs/${runId}/invites/${(await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data.review.invites.find((i: any) => i.state === 'unused').id}`, { as: OWNER })
    }
    const { cookie } = await joinAsGuest(runId, 'Dana')
    const review = (await h.request('GET', `/runs/${runId}/review`, asGuest(cookie))).json.data
    const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
    const saved = await h.request('PUT', `/runs/${runId}/review`, { ...asGuest(cookie, { Origin: ORIGIN }), ifMatch: review.sessionRevision, body: { ratings } })
    await h.request('POST', `/runs/${runId}/review/submit`, { ...asGuest(cookie, { Origin: ORIGIN }), ifMatch: saved.json.data.sessionRevision, body: {} })
    const view = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    await h.request('POST', `/runs/${runId}/reveal`, { as: OWNER, ifMatch: view.revision, body: { acknowledgePendingCount: 2 } })
    const results = (await h.request('GET', `/runs/${runId}/results`, { as: OWNER })).json.data
    const reviewers = results.cases.flatMap((c: any) => c.judgments.map((j: any) => j.reviewer))
    expect(reviewers.some((label: string) => label.endsWith('(guest, no account)'))).toBe(true)
  })

  it('lets the judge sign out a filed guest’s devices; the worksheet stays', async () => {
    const { runId } = await reviewingHearing()
    const { cookie } = await joinAsGuest(runId, 'Dana')
    const review = (await h.request('GET', `/runs/${runId}/review`, asGuest(cookie))).json.data
    const ratings = review.cases.flatMap((c: any) => c.responses.map((r: any) => ({ responseId: r.responseId, correctness: 2, completeness: 2, grounding: 2, note: '', suspectedIdentityClue: false })))
    const saved = await h.request('PUT', `/runs/${runId}/review`, { ...asGuest(cookie, { Origin: ORIGIN }), ifMatch: review.sessionRevision, body: { ratings } })
    await h.request('POST', `/runs/${runId}/review/submit`, { ...asGuest(cookie, { Origin: ORIGIN }), ifMatch: saved.json.data.sessionRevision, body: {} })
    const guestRow = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data.review.participants.find((p: any) => p.guest)
    expect((await h.request('POST', `/runs/${runId}/reviewers/${guestRow.id}/sign-out-devices`, { as: REVIEWER, body: {} })).status).toBe(404)
    expect((await h.request('POST', `/runs/${runId}/reviewers/${guestRow.id}/sign-out-devices`, { as: OWNER, body: {} })).status).toBe(204)
    expect((await h.request('GET', `/runs/${runId}`, asGuest(cookie))).status).toBe(401)
    const after = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data.review.participants.find((p: any) => p.id === guestRow.id)
    expect(after.status).toBe('submitted')
  })
})

describe('the judge’s controls', () => {
  it('shows the guest’s name only to the judge and removal revokes every device', async () => {
    const { runId } = await reviewingHearing()
    await h.request('POST', '/invites/redeem', { as: REVIEWER, body: { token: await invite(runId) } })
    const { cookie } = await joinAsGuest(runId, 'Dana Q')
    const owner = (await h.request('GET', `/runs/${runId}`, { as: OWNER })).json.data
    const guestRow = owner.review.participants.find((p: any) => p.guest)
    expect(guestRow.guest).toMatchObject({ name: 'Dana Q', devices: 1 })
    expect((await h.request('GET', `/runs/${runId}`, { as: REVIEWER })).text).not.toContain('Dana Q')
    expect((await h.request('DELETE', `/runs/${runId}/reviewers/${guestRow.id}`, { as: OWNER })).status).toBe(204)
    expect((await h.request('GET', `/runs/${runId}/review`, asGuest(cookie))).status).toBe(401)
  })

  it('a revoked device is refused, and deleting the case purges guest access', async () => {
    const { setup, runId } = await reviewingHearing()
    const { cookie } = await joinAsGuest(runId)
    await h.db.prepare('UPDATE juror_devices SET revoked_at = 1').run()
    expect((await h.request('GET', `/runs/${runId}`, asGuest(cookie))).status).toBe(401)
    const evaluation = (await h.request('GET', `/evaluations/${setup.evaluationId}`, { as: OWNER })).json.data
    expect((await h.request('DELETE', `/evaluations/${setup.evaluationId}`, { as: OWNER, ifMatch: evaluation.revision, body: { confirmTitle: evaluation.title } })).status).toBe(202)
    await runMaintenance(h.deps)
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM juror_principals').first<any>()).n).toBe(0)
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM juror_devices').first<any>()).n).toBe(0)
  })
})

describe('read rate limiting (D-13)', () => {
  it('limits reads per caller per minute', async () => {
    let last = 200
    for (let i = 0; i < 121; i++) last = (await h.request('GET', '/evaluations', { as: OTHER })).status
    expect(last).toBe(429)
    h.advance(60_000)
    expect((await h.request('GET', '/evaluations', { as: OTHER })).status).toBe(200)
  })
})
