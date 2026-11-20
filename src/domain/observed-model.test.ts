import { describe, expect, it } from 'vitest'
import { observedModelNote } from './observed-model'

describe('observedModelNote (D-115)', () => {
  it('is silent when Google answers with the model asked for, or a stable version of it', () => {
    expect(observedModelNote('google', 'gemini-3.6-flash', 'gemini-3.6-flash')).toBeNull()
    expect(observedModelNote('google', 'gemini-3.6-flash', 'gemini-3.6-flash-001')).toBeNull()
    expect(observedModelNote('google', 'gemini-3.6-flash', 'models/gemini-3.6-flash')).toBeNull()
    expect(observedModelNote('google', 'gemini-3.6-flash', null)).toBeNull()
    expect(observedModelNote('google', 'gemini-3.6-flash', ' ')).toBeNull()
  })

  it('says so when Google answers with another model, even one whose name starts the same', () => {
    expect(observedModelNote('google', 'gemini-3.6-flash', 'gemini-3.6-flash-lite')).toBe('Google reported that gemini-3.6-flash-lite answered, not gemini-3.6-flash, the model this hearing asked for.')
    expect(observedModelNote('google', 'gemini-2.5-flash', 'gemini-3-flash')).toContain('gemini-3-flash answered')
    // The dot in the requested ID is literal.
    expect(observedModelNote('google', 'gemini-3.6-flash', 'gemini-3x6-flash-001')).not.toBeNull()
  })

  it('never compares OpenAI or Anthropic, which report dated snapshots for an alias', () => {
    expect(observedModelNote('openai', 'gpt-6-luna', 'gpt-6-luna-2026-10-01')).toBeNull()
    expect(observedModelNote('anthropic', 'claude-haiku-5-5', 'claude-haiku-5-5-20261001')).toBeNull()
  })
})
