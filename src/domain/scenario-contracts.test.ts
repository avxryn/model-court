import { describe, expect, it } from 'vitest'
import { restoreDraftSchema, startRunSchema } from './contracts'

const id = '11111111-1111-4111-8111-111111111111'

describe('spec 02 contracts (D-69)', () => {
  it('restoreDraftSchema needs a hearing id and at least one part, and nothing else', () => {
    expect(restoreDraftSchema.safeParse({ fromRunId: id, questions: true, parties: false }).success).toBe(true)
    expect(restoreDraftSchema.safeParse({ fromRunId: id, questions: false, parties: true }).success).toBe(true)
    expect(restoreDraftSchema.safeParse({ fromRunId: id, questions: false, parties: false }).success).toBe(false)
    expect(restoreDraftSchema.safeParse({ fromRunId: 'nope', questions: true, parties: true }).success).toBe(false)
    expect(restoreDraftSchema.safeParse({ fromRunId: id, questions: true, parties: true, imports: true }).success).toBe(false)
  })

  it('startRunSchema accepts an optional 64-hex expected scenario hash', () => {
    const base = { draftRevision: 1, credentialIdsByProvider: {}, consentToProviderProcessing: true, acknowledgeProviderCharges: true }
    expect(startRunSchema.safeParse(base).success).toBe(true)
    expect(startRunSchema.safeParse({ ...base, expectedScenarioHash: 'a'.repeat(64) }).success).toBe(true)
    expect(startRunSchema.safeParse({ ...base, expectedScenarioHash: 'A'.repeat(64) }).success).toBe(false)
    expect(startRunSchema.safeParse({ ...base, expectedScenarioHash: 'a'.repeat(63) }).success).toBe(false)
  })
})
