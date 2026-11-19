import { describe, expect, it } from 'vitest'
import { citationsOf, parseCitations, type Segment } from './citations'

function cites(text: string) {
  return citationsOf(text).map((cite) => ({ sources: cite.sources, quote: cite.quote }))
}

function roundTrip(segments: Segment[]): string {
  return segments.map((segment) => (segment.kind === 'text' ? segment.text : segment.raw)).join('')
}

describe('parseCitations (grounded-v1 format)', () => {
  it('reads single citations, lists, quotes and curly quotes', () => {
    expect(cites('Refunds take 30 days [S1].')).toEqual([{ sources: [1], quote: null }])
    expect(cites('Both apply [S1, S3] and [s2,S4].')).toEqual([
      { sources: [1, 3], quote: null },
      { sources: [2, 4], quote: null },
    ])
    expect(cites('It says [S2: "within 30 days"].')).toEqual([{ sources: [2], quote: 'within 30 days' }])
    expect(cites('It says [S2:“within 30 days”].')).toEqual([{ sources: [2], quote: 'within 30 days' }])
    expect(cites('[ S1 , S3 : "a" ]')).toEqual([{ sources: [1, 3], quote: 'a' }])
  })

  it('parses numbers it cannot resolve (S0, S9, S99) but not three digits', () => {
    expect(cites('[S9] [S0] [S99]')).toEqual([
      { sources: [9], quote: null },
      { sources: [0], quote: null },
      { sources: [99], quote: null },
    ])
    expect(cites('[S100] [S] [1] [Source 2] (S2) [S1a]')).toEqual([])
  })

  it('a ] inside a quote is part of the quote', () => {
    expect(cites('[S2: "see [note] here"]')).toEqual([{ sources: [2], quote: 'see [note] here' }])
  })

  it('refuses unclosed brackets, empty quotes, mismatched marks and line breaks inside a quote', () => {
    expect(cites('[S1 and more')).toEqual([])
    expect(cites('[S1: ""]')).toEqual([])
    expect(cites('[S1: "abc”]')).toEqual([])
    expect(cites('[S1: "line\nbreak"]')).toEqual([])
    expect(cites('[S1:]')).toEqual([])
  })

  it('a markdown link is not a citation', () => {
    expect(cites('[S1](https://example.com) but [S2] counts')).toEqual([{ sources: [2], quote: null }])
  })

  it('keeps emoji and combining characters in quotes, counting code points', () => {
    expect(cites('[S1: "café 👍 é"]')).toEqual([{ sources: [1], quote: 'café 👍 é' }])
    expect(cites(`[S1: "${'👍'.repeat(1000)}"]`)).toHaveLength(1)
    expect(cites(`[S1: "${'👍'.repeat(1001)}"]`)).toHaveLength(0)
  })

  it('offsets round-trip and match the raw text', () => {
    const text = 'A [S1] b [S2: "x"] c [nope] [S3'
    const segments = parseCitations(text)
    expect(roundTrip(segments)).toBe(text)
    for (const segment of segments) if (segment.kind === 'cite') expect(text.slice(segment.start, segment.end)).toBe(segment.raw)
    expect(parseCitations('')).toEqual([])
  })

  it('parses at most 200 citations; the rest is text', () => {
    const text = '[S1] '.repeat(250)
    const segments = parseCitations(text)
    expect(segments.filter((segment) => segment.kind === 'cite')).toHaveLength(200)
    expect(roundTrip(segments)).toBe(text)
  })

  it('16 KiB of adversarial input stays fast (single pass)', () => {
    const inputs = ['[S1: “'.repeat(2700), '[S1, '.repeat(3200), '['.repeat(16_000), `[S1: "${'a'.repeat(999)}`.repeat(16), '[S1:"'.repeat(3200)]
    for (const input of inputs) {
      const started = performance.now()
      const segments = parseCitations(input)
      expect(performance.now() - started).toBeLessThan(250)
      expect(roundTrip(segments)).toBe(input)
    }
  })
})
