import { describe, expect, it } from 'vitest'
import type { EvaluationSummary } from '@/lib/dto'
import { waitingHref, waitingItems } from './docket'

const item = (over: Partial<EvaluationSummary>): EvaluationSummary => ({ id: 'case-1', title: 'Case', role: 'owner', latestRunStatus: null, latestRunId: 'run-1', updatedAt: 1, ...over })

describe('waitingHref', () => {
  it('sends each step to the hearing page that has its action', () => {
    const [judgment] = waitingItems([item({ latestRunStatus: 'revealed' })])
    const [unseal] = waitingItems([item({ latestRunStatus: 'reviewing' })])
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
