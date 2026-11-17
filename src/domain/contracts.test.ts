import { describe, expect, it } from 'vitest'
import { createCredentialSchema, draftInputSchema, verdictSchema } from './contracts'
import { canonicalJson, sha256Hex } from './canonical'
import { makeExampleDraft } from './example'
import { buildMessages } from './messages'
import { LIMITS } from './limits'

const newId = () => crypto.randomUUID()
const draft = () => makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])

describe('draftInputSchema (T03)', () => {
  it('accepts the seeded example', () => {
    expect(draftInputSchema.safeParse(draft()).success).toBe(true)
  })

  it('accepts exact limits by code point and rejects limit + 1', () => {
    const emoji = '😀' // one code point, two UTF-16 units, four UTF-8 bytes
    const atLimit = draft()
    atLimit.cases[0].title = emoji.repeat(LIMITS.caseTitle.max)
    expect(draftInputSchema.safeParse(atLimit).success).toBe(true)
    const over = draft()
    over.cases[0].title = emoji.repeat(LIMITS.caseTitle.max + 1)
    expect(draftInputSchema.safeParse(over).success).toBe(false)
  })

  it('preserves Unicode exactly (no normalization)', () => {
    const value = draft()
    value.cases[0].input = 'Café vs Café — ¿devolución?'
    const parsed = draftInputSchema.parse(value)
    expect(parsed.cases[0].input).toBe('Café vs Café — ¿devolución?')
  })

  it('rejects unknown fields, empty fields, duplicate keys, and case-count bounds', () => {
    expect(draftInputSchema.safeParse({ ...draft(), extra: 1 }).success).toBe(false)
    const empty = draft()
    empty.cases[0].input = ''
    expect(draftInputSchema.safeParse(empty).success).toBe(false)
    const dup = draft()
    dup.cases[1].key = dup.cases[0].key
    expect(draftInputSchema.safeParse(dup).success).toBe(false)
    expect(draftInputSchema.safeParse({ ...draft(), cases: [] }).success).toBe(false)
    const six = draft()
    six.cases.push({ ...six.cases[0], key: newId() })
    expect(draftInputSchema.safeParse(six).success).toBe(false)
  })

  it('requires exactly two configurations with the fixed output cap', () => {
    const one = draft()
    one.configurations.pop()
    expect(draftInputSchema.safeParse(one).success).toBe(false)
    const cap = draft() as unknown as { configurations: { maxOutputTokens: number }[] }
    cap.configurations[0].maxOutputTokens = 4096
    expect(draftInputSchema.safeParse(cap).success).toBe(false)
  })

  it('enforces the 96 KiB draft cap irrespective of field limits', () => {
    const big = draft()
    for (const c of big.cases) {
      c.reference = '界'.repeat(LIMITS.caseReference.max) // 3 bytes each → 24 KB per case
    }
    expect(draftInputSchema.safeParse(big).success).toBe(false)
  })
})

describe('verdictSchema', () => {
  const base = { rationale: 'A' + 'x'.repeat(19), limitations: '' }
  it('requires a selected key only for "selected"', () => {
    expect(verdictSchema.safeParse({ ...base, outcome: 'tie' }).success).toBe(true)
    expect(verdictSchema.safeParse({ ...base, outcome: 'selected' }).success).toBe(false)
    expect(verdictSchema.safeParse({ ...base, outcome: 'selected', selectedConfigurationKey: newId() }).success).toBe(true)
    expect(verdictSchema.safeParse({ ...base, outcome: 'tie', selectedConfigurationKey: newId() }).success).toBe(false)
  })
  it('requires a 20-character rationale', () => {
    expect(verdictSchema.safeParse({ outcome: 'inconclusive', rationale: 'short', limitations: '' }).success).toBe(false)
  })
})

describe('createCredentialSchema', () => {
  const base = { provider: 'openai', label: 'Personal', consentToStorage: true }
  it('trims surrounding whitespace and rejects inner whitespace / control chars', () => {
    expect(createCredentialSchema.parse({ ...base, apiKey: '  sk-test-abc  ' }).apiKey).toBe('sk-test-abc')
    expect(createCredentialSchema.safeParse({ ...base, apiKey: 'sk test' }).success).toBe(false)
    expect(createCredentialSchema.safeParse({ ...base, apiKey: 'sk-\u0007x' }).success).toBe(false)
    expect(createCredentialSchema.safeParse({ ...base, apiKey: '   ' }).success).toBe(false)
  })
  it('requires explicit storage consent and a known provider', () => {
    expect(createCredentialSchema.safeParse({ ...base, consentToStorage: false, apiKey: 'k' }).success).toBe(false)
    expect(createCredentialSchema.safeParse({ ...base, provider: 'azure', apiKey: 'k' }).success).toBe(false)
  })
})

describe('canonicalJson and messages', () => {
  it('sorts keys, preserves arrays, and hashes deterministically', async () => {
    expect(canonicalJson({ b: 1, a: [3, { d: 1, c: 2 }] })).toBe('{"a":[3,{"c":2,"d":1}],"b":1}')
    expect(await sha256Hex(canonicalJson({ b: 1, a: 2 }))).toBe(await sha256Hex(canonicalJson({ a: 2, b: 1 })))
  })

  it('never includes expected behavior in provider messages', () => {
    const c = draft().cases[0]
    const messages = buildMessages('system', c)
    expect(messages.user).toContain(c.input)
    expect(messages.user).toContain(c.reference)
    expect(messages.user).not.toContain(c.expectedBehavior)
    expect(messages.system).toBe('system')
  })
})
