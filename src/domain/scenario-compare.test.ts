import { describe, expect, it } from 'vitest'
import { compareHearings, type CompareHearingInput, type CompareParty, type CompareSession } from './scenario-compare'

const party = (key: string, fingerprint: string, adapterVersion: string | null = 'openai-responses-v1'): CompareParty => ({ key, label: key, fingerprint, source: 'model', provider: 'openai', modelId: 'm', adapterVersion })
const questions = (...hashes: string[]) => hashes.map((hash, i) => ({ caseKey: `c${i + 1}`, questionHash: hash, title: `Q ${hash}`, eligible: true }))
/** A session scoring each listed (case, party) with the given points. */
const session = (contextType: 'invited' | 'owner', accountId: string | null, scores: Record<string, Record<string, number>>, extra: Partial<CompareSession> = {}): CompareSession => ({
  contextType,
  accountId,
  identityClueFlag: false,
  repeatJuror: false,
  scores: Object.entries(scores).flatMap(([caseKey, byParty]) => Object.entries(byParty).map(([configurationKey, points]) => ({ caseKey, configurationKey, points }))),
  ...extra,
})
const hearing = (runId: string, createdAt: number, parties: CompareParty[], qs: CompareHearingInput['questions'], sessions: CompareSession[], extra: Partial<CompareHearingInput> = {}): CompareHearingInput => ({
  runId,
  createdAt,
  revealedAt: createdAt + 1,
  scenarioHash: 's1',
  scenarioVersion: 1,
  rubricVersion: 'reference-qa-v1',
  messageTemplateVersion: 'qa-v1',
  parties,
  questions: qs,
  sessions,
  ...extra,
})

describe('compareHearings (D-70)', () => {
  // Hearing 1: anchor A vs B, two jurors. Hearing 2: anchor A (key renamed) vs C, one juror.
  const h1 = hearing('r1', 1, [party('a1', 'A'), party('b', 'B')], questions('x', 'y'), [
    session('invited', 'u1', { c1: { a1: 4, b: 5 }, c2: { a1: 4, b: 6 } }),
    session('invited', 'u2', { c1: { a1: 5, b: 5 }, c2: { a1: 3, b: 4 } }),
    session('owner', 'judge', { c1: { a1: 0, b: 0 }, c2: { a1: 0, b: 0 } }),
  ])
  const h2 = hearing('r2', 2, [party('a2', 'A'), party('c', 'C')], questions('y', 'x'), [session('invited', 'u1', { c1: { a2: 4, c: 3 }, c2: { a2: 4, c: 5 } }, { repeatJuror: true })])

  it('gives each hearing its own means from the jury only, and an anchor difference within each hearing', () => {
    const result = compareHearings([h2, h1])
    expect(result.hearings.map((h) => h.runId)).toEqual(['r1', 'r2'])
    const [first, second] = result.hearings
    expect(first).toMatchObject({ raterSource: 'jury', raterCount: 2, guestRaterCount: 0 })
    // a1: q1 (4+5)/2 = 4.5, q2 (4+3)/2 = 3.5 → 4; b: 5, 5 → 5. The judge's zeros are not mixed in.
    expect(first.parties.find((p) => p.key === 'a1')).toMatchObject({ meanPoints: 4, questions: 2 })
    expect(first.parties.find((p) => p.key === 'b')).toMatchObject({ meanPoints: 5, questions: 2 })
    expect(second.parties.find((p) => p.key === 'a2')).toMatchObject({ meanPoints: 4, questions: 2 })
    expect(result.anchors).toEqual([{ fingerprint: 'A', label: 'a2', byHearing: { r1: { configurationKey: 'a1', meanPoints: 4, questions: 2, raters: 2 }, r2: { configurationKey: 'a2', meanPoints: 4, questions: 2, raters: 1 } } }])
    // B over A in hearing 1: q1 +0.5, q2 +1.5 → +1, better on both. C over A in hearing 2 (c1 is 'y', c2 is 'x'): -1 and +1.
    expect(result.relative).toEqual([
      { runId: 'r1', configurationKey: 'b', label: 'b', anchorFingerprint: 'A', meanDiff: 1, better: 2, worse: 0, tied: 0, questions: 2, raters: 2 },
      { runId: 'r2', configurationKey: 'c', label: 'c', anchorFingerprint: 'A', meanDiff: 0, better: 1, worse: 1, tied: 0, questions: 2, raters: 1 },
    ])
    expect(result.commonQuestionCount).toBe(2)
    expect(result.comparable).toEqual({ sameQuestions: true, sameRubric: true, sameTemplate: true, sameRaterSource: true, adapterChanged: false })
    expect(result.jurorOverlap).toEqual([{ runIds: ['r1', 'r2'], shared: 1, knowable: 1, guests: 0 }])
    expect(result.caveats.sort()).toEqual(['different_juries', 'few_raters', 'repeat_jurors'])
    expect(second).toMatchObject({ repeatJurorCount: 1, potentiallyUnblindedCount: 1 })
  })

  it('uses only questions every hearing shares, and only eligible ones', () => {
    const extra = hearing('r3', 3, [party('a3', 'A'), party('d', 'D')], [...questions('x', 'z'), { caseKey: 'c3', questionHash: 'y', title: 'Q y', eligible: false }], [session('invited', null, { c1: { a3: 6, d: 2 }, c2: { a3: 0, d: 6 } })])
    const result = compareHearings([h1, h2, extra])
    expect(result.commonQuestionCount).toBe(1)
    expect(result.caveats).toContain('questions_partial')
    expect(result.questions.find((q) => q.questionHash === 'z')).toEqual({ questionHash: 'z', title: 'Q z', presentIn: ['r3'] })
    // Only 'x': in r3 that is c1 (a3 6, d 2).
    expect(result.relative.find((r) => r.runId === 'r3')).toMatchObject({ meanDiff: -4, worse: 1, questions: 1 })
    expect(result.hearings.find((h) => h.runId === 'r3')).toMatchObject({ guestRaterCount: 1 })
    expect(result.jurorOverlap.find((o) => o.runIds[1] === 'r3')).toMatchObject({ shared: 0, knowable: 0, guests: 1 })
  })

  it('uses the judge when no juror filed, never mixed, and flags the different source', () => {
    const solo = hearing('r4', 4, [party('a4', 'A'), party('e', 'E')], questions('x', 'y'), [session('owner', 'judge', { c1: { a4: 2, e: 4 }, c2: { a4: 2, e: 4 } })])
    const result = compareHearings([h1, solo])
    expect(result.hearings[1]).toMatchObject({ raterSource: 'judge', raterCount: 1 })
    expect(result.relative.find((r) => r.runId === 'r4')).toMatchObject({ meanDiff: 2 })
    expect(result.comparable.sameRaterSource).toBe(false)
    expect(result.caveats).toContain('rater_source_differs')
  })

  it('has no relative numbers without an anchor, and flags a different rubric or request format', () => {
    const other = hearing('r5', 5, [party('f', 'F', 'openai-responses-v2'), party('g', 'G')], questions('x', 'y'), [session('invited', 'u9', { c1: { f: 1, g: 2 }, c2: { f: 1, g: 2 } })], { rubricVersion: 'safety-v1' })
    const result = compareHearings([h1, other])
    expect(result.anchors).toEqual([])
    expect(result.relative).toEqual([])
    expect(result.caveats).toEqual(expect.arrayContaining(['no_anchor', 'rubric_differs']))
    const upgraded = hearing('r6', 6, [party('a6', 'A', 'openai-responses-v2'), party('h', 'H')], questions('x', 'y'), [])
    expect(compareHearings([h1, upgraded]).comparable.adapterChanged).toBe(true)
  })
})
