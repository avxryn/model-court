import { describe, expect, it } from 'vitest'
import { compareHearings } from '@/domain/scenario-compare'
import { recordTally } from './headline'

/** The comparison's per-hearing numbers must be the record's headline numbers (D-60, D-70). */
describe('compareHearings agrees with the record headline for one hearing', () => {
  const parties = [
    { key: 'a', label: 'Party A' },
    { key: 'b', label: 'Party B' },
  ]
  const line = (reviewer: string, contextType: 'invited' | 'owner', configurationKey: string, c: number, m: number, g: number) => ({ reviewer, contextType, configurationKey, correctness: c, completeness: m, grounding: g })
  const cases = [
    { key: 'q1', title: 'Q1', eligible: true, judgments: [line('Juror 1', 'invited', 'a', 2, 2, 1), line('Juror 1', 'invited', 'b', 1, 1, 1), line('Juror 2', 'invited', 'a', 1, 0, 1), line('Juror 2', 'invited', 'b', 2, 2, 2), line('Judge', 'owner', 'a', 0, 0, 0), line('Judge', 'owner', 'b', 0, 0, 0)] },
    { key: 'q2', title: 'Q2', eligible: true, judgments: [line('Juror 1', 'invited', 'a', 2, 2, 2), line('Juror 1', 'invited', 'b', 0, 1, 0), line('Juror 2', 'invited', 'a', 2, 1, 2), line('Juror 2', 'invited', 'b', 1, 1, 1)] },
    { key: 'q3', title: 'Q3', eligible: false, judgments: [] },
  ]

  it('gives the same mean points per question for each party', () => {
    const tally = recordTally({ cases, configurations: parties } as never)
    const sessions = ['Juror 1', 'Juror 2', 'Judge'].map((reviewer) => ({
      contextType: (reviewer === 'Judge' ? 'owner' : 'invited') as 'owner' | 'invited',
      accountId: reviewer,
      identityClueFlag: false,
      repeatJuror: false,
      scores: cases.flatMap((c) => c.judgments.filter((j) => j.reviewer === reviewer).map((j) => ({ caseKey: c.key, configurationKey: j.configurationKey, points: j.correctness + j.completeness + j.grounding }))),
    }))
    const result = compareHearings([
      {
        runId: 'r',
        createdAt: 1,
        revealedAt: 2,
        scenarioHash: 's',
        scenarioVersion: 1,
        rubricVersion: 'reference-qa-v1',
        messageTemplateVersion: 'qa-v1',
        parties: parties.map((p) => ({ ...p, fingerprint: p.key, source: 'model' as const, provider: 'openai', modelId: 'm', adapterVersion: 'v' })),
        questions: cases.map((c) => ({ caseKey: c.key, questionHash: c.key, title: c.title, eligible: c.eligible })),
        sessions,
      },
    ])
    expect(tally.source).toBe('jury')
    for (const party of tally.parties) {
      const compared = result.hearings[0].parties.find((p) => p.key === party.key)!
      expect(compared.questions).toBe(tally.questions.length)
      expect(compared.meanPoints).toBeCloseTo(party.total / tally.questions.length, 10)
    }
    expect(result.hearings[0].raterCount).toBe(tally.raters)
  })
})
