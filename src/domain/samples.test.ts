import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from './canonical'
import { draftInputSchema } from './contracts'
import { makeExampleDraft } from './example'
import { plannedCalls } from './quota'
import { MODEL_ROUTES } from './registry'
import { buildSnapshot, samplesPerAnswer } from './snapshot'

const newId = () => crypto.randomUUID()
const imported = () => ({ kind: 'imported' as const, key: newId(), label: 'Baseline', provenance: { sourceType: 'human_baseline' as const, description: 'Written by the support team.', redacted: false } })

describe('samples per answer (D-65)', () => {
  const draft = makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])

  it('accepts 2 and 3; rejects 0, 1 and 4', () => {
    for (const value of [2, 3]) expect(draftInputSchema.safeParse({ ...draft, samplesPerAnswer: value }).success, String(value)).toBe(true)
    for (const value of [0, 1, 4, 2.5, '2']) expect(draftInputSchema.safeParse({ ...draft, samplesPerAnswer: value }).success, String(value)).toBe(false)
  })

  it('is refused when every party is imported', () => {
    const importedOnly = { ...draft, comparisonMode: 'configuration' as const, configurations: [imported(), imported()] }
    expect(draftInputSchema.safeParse(importedOnly).success).toBe(true)
    const result = draftInputSchema.safeParse({ ...importedOnly, samplesPerAnswer: 2 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toEqual(['samplesPerAnswer'])
    // One generated party is enough.
    expect(draftInputSchema.safeParse({ ...draft, comparisonMode: 'configuration', configurations: [draft.configurations[0], imported()], samplesPerAnswer: 2 }).success).toBe(true)
  })

  it('leaves snapshots without repeats byte-identical, so their hashes do not change', async () => {
    const without = buildSnapshot({ ...draft, schemaVersion: 1 }, MODEL_ROUTES, 'test', 0)
    expect(Object.hasOwn(without, 'samplesPerAnswer')).toBe(false)
    expect(samplesPerAnswer(without)).toBe(1)
    const withThree = buildSnapshot({ ...draft, samplesPerAnswer: 3, schemaVersion: 1 }, MODEL_ROUTES, 'test', 0)
    expect(withThree.samplesPerAnswer).toBe(3)
    expect(samplesPerAnswer(withThree)).toBe(3)
    const { samplesPerAnswer: _s, ...rest } = withThree
    expect(canonicalJson(rest)).toBe(canonicalJson(without))
    expect(await sha256Hex(canonicalJson(withThree))).not.toBe(await sha256Hex(canonicalJson(without)))
  })

  it('multiplies planned calls by samples for generated parties only', () => {
    expect(plannedCalls(draft)).toBe(10)
    expect(plannedCalls({ ...draft, samplesPerAnswer: 3 })).toBe(30)
    expect(plannedCalls({ ...draft, configurations: [draft.configurations[0], imported()], samplesPerAnswer: 2 })).toBe(10)
    expect(plannedCalls({ ...draft, configurations: [imported(), imported()] })).toBe(0)
  })
})
