import { describe, expect, it } from 'vitest'
import { blindingWarnings, GENERATED_ANSWER_CHARS } from './blinding-lint'

describe('blinding lint (D-38)', () => {
  it('stays quiet on an ordinary answer', () => {
    expect(blindingWarnings('Returns are accepted within 30 days with a receipt, so your purchase qualifies.')).toEqual([])
  })

  it('flags emails, links, numbers, greetings, sign-offs, and length', () => {
    const kinds = (text: string) => blindingWarnings(text).map((w) => w.kind)
    expect(kinds('Write to help@example.com')).toContain('email')
    expect(kinds('See https://example.com/returns')).toContain('url')
    expect(kinds('Ticket +1 (555) 010-2030 is open')).toContain('phone')
    expect(kinds('Hi Sam,\nYes, you can return it.')).toContain('greeting')
    expect(kinds('You can return it.\nThanks, Jo')).toContain('signoff')
    expect(kinds('x'.repeat(GENERATED_ANSWER_CHARS * 2))).toContain('length')
  })
})
