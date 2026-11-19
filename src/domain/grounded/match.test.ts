import { describe, expect, it } from 'vitest'
import { containsRefusalV1, findQuoteV1, normalizeQuoteV1, quoteFragmentsV1 } from './match'

describe('normalizeQuoteV1', () => {
  it('applies NFKC, lower case, ASCII quotes and dashes, drops emphasis, collapses whitespace', () => {
    expect(normalizeQuoteV1('  The “Refund”  —\tpolicy’s **ﬁne** print\n').text).toBe('the "refund" - policy\'s fine print')
    expect(normalizeQuoteV1('Ｆｕｌｌ ｗｉｄｔｈ').text).toBe('full width')
  })

  it('composes a letter with its combining mark like the precomposed form', () => {
    expect(normalizeQuoteV1('cafe' + String.fromCodePoint(0x301)).text).toBe(normalizeQuoteV1('caf' + String.fromCodePoint(0xe9)).text)
  })

  it('maps every normalized unit back to the original', () => {
    const source = 'One  “two” ﬁve'
    const normalized = normalizeQuoteV1(source)
    expect(normalized.starts).toHaveLength(normalized.text.length)
    expect(normalized.ends).toHaveLength(normalized.text.length)
    const at = normalized.text.indexOf('"two"')
    expect(source.slice(normalized.starts[at], normalized.ends[at + 4])).toBe('“two”')
  })
})

describe('findQuoteV1', () => {
  const source = 'Customers can request a refund within 30 days of purchase. Refunds go back to the original payment method.'

  it('finds a quote and returns its span in the original', () => {
    const spans = findQuoteV1(source, 'request a REFUND within 30 days')
    expect(spans).toHaveLength(1)
    expect(source.slice(spans![0].start, spans![0].end)).toBe('request a refund within 30 days')
  })

  it('splits at ellipses and finds the fragments in order only', () => {
    expect(quoteFragmentsV1('refund … original payment')).toEqual(['refund', 'original payment'])
    expect(findQuoteV1(source, 'request a refund ... original payment method')).toHaveLength(2)
    expect(findQuoteV1(source, 'original payment ... request a refund')).toBeNull()
    expect(findQuoteV1(source, '...')).toBeNull()
  })

  it('returns null for words not in the source', () => {
    expect(findQuoteV1(source, 'within 60 days')).toBeNull()
  })
})

describe('containsRefusalV1', () => {
  it('matches the fixed sentence after normalization, period optional', () => {
    expect(containsRefusalV1('The sources do not contain the answer.')).toBe(true)
    expect(containsRefusalV1('Sorry. THE SOURCES DO NOT CONTAIN THE ANSWER')).toBe(true)
    expect(containsRefusalV1('**The sources do not contain the answer**, but S1 is close.')).toBe(true)
  })

  it('does not match paraphrases or a longer word', () => {
    expect(containsRefusalV1("The provided passages don't say.")).toBe(false)
    expect(containsRefusalV1('The sources do not contain the answers.')).toBe(false)
  })
})
