import { describe, expect, it } from 'vitest'
import type { EvaluationSummary } from '@/lib/dto'
import { caseChip, waitingHref, waitingItems, waitingKind } from './docket'

const item = (over: Partial<EvaluationSummary>): EvaluationSummary => ({ id: 'case-1', title: 'Case', role: 'owner', latestRunStatus: null, latestRunId: 'run-1', jurors: { joined: 0, filed: 0 }, viewerFiled: false, updatedAt: 1, ...over })

describe('a deliberating hearing', () => {
  const reviewing = (over: Partial<EvaluationSummary>) => item({ latestRunStatus: 'reviewing', ...over })

  it('waits on jurors, not the judge, until someone files', () => {
    const waiting = reviewing({ jurors: { joined: 2, filed: 0 } })
    expect(waitingKind(waiting)).toBeNull()
    expect(caseChip(waiting).label).toBe('Waiting on jurors')
  })

  it('asks the judge to unseal once a juror has filed, and shows progress', () => {
    const partly = reviewing({ jurors: { joined: 3, filed: 1 } })
    expect(waitingKind(partly)).toBe('unseal')
    expect(caseChip(partly).label).toBe('1 of 3 filed')
  })

  it('asks a judge with no jurors for their own review, then to unseal', () => {
    expect(waitingKind(reviewing({}))).toBe('review')
    expect(waitingHref(waitingItems([reviewing({})])[0])).toBe('/runs/run-1/review')
    expect(waitingKind(reviewing({ viewerFiled: true }))).toBe('unseal')
    expect(caseChip(reviewing({})).label).toBe('Deliberating')
  })

  it('stops asking a juror once they have filed', () => {
    const juror = reviewing({ role: 'reviewer', jurors: null })
    expect(waitingKind(juror)).toBe('score')
    expect(waitingKind({ ...juror, viewerFiled: true })).toBeNull()
    expect(caseChip({ ...juror, viewerFiled: true }).label).toBe('Filed')
  })
})

describe('waitingHref', () => {
  it('sends each step to the hearing page that has its action', () => {
    const [judgment] = waitingItems([item({ latestRunStatus: 'revealed' })])
    const [unseal] = waitingItems([item({ latestRunStatus: 'reviewing', jurors: { joined: 1, filed: 1 } })])
    const [open] = waitingItems([item({ latestRunStatus: 'ready' })])
    const [score] = waitingItems([item({ role: 'reviewer', latestRunStatus: 'reviewing' })])
    expect(waitingHref(judgment)).toBe('/runs/run-1/judgment')
    expect(waitingHref(unseal)).toBe('/runs/run-1')
    expect(waitingHref(open)).toBe('/runs/run-1')
    expect(waitingHref(score)).toBe('/runs/run-1/review')
  })

  it('falls back to the case page when the hearing is unknown', () => {
    const [judgment] = waitingItems([item({ latestRunStatus: 'revealed', latestRunId: null })])
    expect(waitingHref(judgment)).toBe('/evaluations/case-1')
  })
})
