import { describe, expect, it } from 'vitest'
import { containsPhraseV1, countCharactersV1, countWordsV1, extractNumbersV1, normalizeForMatchV1, normalizeLabelV1, splitLinesV1 } from './text'

describe('kit text helpers v1', () => {
  it('normalizes for matching: NFKC, case, curly quotes and dashes, emphasis, whitespace', () => {
    expect(normalizeForMatchV1('  The **Refund**   window — 30 days  ')).toBe('the refund window - 30 days')
    expect(normalizeForMatchV1('“Don’t” `code` _x_')).toBe('"don\'t" code x')
    expect(normalizeForMatchV1('ﬁnal Ｒｅｆｕｎｄ')).toBe('final refund')
    expect(normalizeForMatchV1('a\r\n\tb')).toBe('a b')
  })

  it('matches phrases literally with word boundaries', () => {
    expect(containsPhraseV1('Refunds take 5 days.', 'refund')).toBe(false)
    expect(containsPhraseV1('The refund takes 5 days.', 'Refund')).toBe(true)
    expect(containsPhraseV1('No refund.', 'refund')).toBe(true)
    expect(containsPhraseV1('refund', 'refund')).toBe(true)
    expect(containsPhraseV1('prefund', 'refund')).toBe(false)
    expect(containsPhraseV1('within **30 days**', '30 days')).toBe(true)
    expect(containsPhraseV1('within 300 days', '30 days')).toBe(false)
    expect(containsPhraseV1('cost $45 total', '$45')).toBe(true)
    expect(containsPhraseV1('Café opens', 'café')).toBe(true)
    expect(containsPhraseV1('Cafés open', 'café')).toBe(false)
    expect(containsPhraseV1('anything', '')).toBe(false)
    // A later occurrence still counts when the first one is inside a word.
    expect(containsPhraseV1('refunds, then a refund', 'refund')).toBe(true)
    // Regex metacharacters are plain text.
    expect(containsPhraseV1('see (a+b)*c here', '(a+b)*c')).toBe(true)
    expect(containsPhraseV1('aaaa', 'a.*')).toBe(false)
  })

  it('matches inside scripts written without spaces', () => {
    expect(containsPhraseV1('我要退款。', '退款')).toBe(true)
    expect(containsPhraseV1('返金は30日以内です', '30日')).toBe(true)
    expect(containsPhraseV1('ขอคืนเงินภายใน', 'คืนเงิน')).toBe(true)
  })

  it('counts words and characters', () => {
    expect(countWordsV1('One two  three')).toBe(3)
    expect(countWordsV1('- First point\n- Second\n1. Third')).toBe(4)
    expect(countWordsV1('— • * 1.')).toBe(1)
    expect(countWordsV1('')).toBe(0)
    expect(countCharactersV1('退款 30 日')).toBe(5)
    expect(countCharactersV1('a b\nc')).toBe(3)
    expect(countCharactersV1('😀x')).toBe(2)
  })

  it('splits lines on CR LF, CR and LF', () => {
    expect(splitLinesV1('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('extracts numbers, ignoring list markers', () => {
    expect(extractNumbersV1('Pay 1,000 or 1.5 now, within 12 days.')).toEqual(['1000', '1.5', '12'])
    expect(extractNumbersV1('1. First 45\n2) Second\n  3. Third 2027')).toEqual(['45', '2027'])
    expect(extractNumbersV1('11/18 and 2026-11-18')).toEqual(['11', '18', '2026', '11', '18'])
    expect(extractNumbersV1('Ends at 45.')).toEqual(['45'])
    expect(extractNumbersV1('3 apples')).toEqual(['3'])
    expect(extractNumbersV1('three apples')).toEqual([])
  })

  it('normalizes labels', () => {
    expect(normalizeLabelV1('  **Account   Access**. ')).toBe('account access')
    expect(normalizeLabelV1('"Billing"')).toBe('billing')
    expect(normalizeLabelV1('`Bug`')).toBe('bug')
  })

  it('a phrase that only occurs inside longer words is still found later at a word start', () => {
    expect(containsPhraseV1('aaaa aa', 'aa')).toBe(true)
    expect(containsPhraseV1('aaaa aaa', 'aa')).toBe(false)
    expect(containsPhraseV1('xrefund refund', 'refund')).toBe(true)
    expect(containsPhraseV1('ﬃ ffi', 'ffi')).toBe(true)
  })

  it('stays fast on worst-case input (linear matching)', () => {
    const started = performance.now()
    // 32 phrases × 15 answers' worth of the matching-prefix worst case (D-80), ASCII and NFKC-expanding.
    for (const text of ['a'.repeat(16_000), 'ﬃ'.repeat(5_400)]) {
      for (let i = 0; i < 32; i++) {
        containsPhraseV1(text, 'a'.repeat(60))
        containsPhraseV1(text, 'f'.repeat(60))
        containsPhraseV1(text, `${'a'.repeat(59)}b`)
      }
    }
    extractNumbersV1('1,'.repeat(8_000))
    countWordsV1('a '.repeat(8_000))
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})
