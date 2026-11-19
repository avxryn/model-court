/**
 * The citation format parties write under `grounded-v1` (spec 05 §6.4, D-92). Pure and
 * browser-safe: the same function drives the checks on the server and the chips in the
 * worksheet, so a party's citations render exactly the way they are checked.
 *
 *   citation := "[" ws? ref (ws? "," ws? ref)* (ws? ":" ws? quote)? ws? "]"
 *   ref      := ("S" | "s") digit digit?          ; 0–99 parsed; only 1..n are real sources
 *   quote    := '"' qchar{1,1000} '"'  |  '“' qchar{1,1000} '”'
 *   qchar    := any character except the closing quote mark and line breaks
 *   ws       := space or tab
 *
 * A bracket followed at once by "(" is a markdown link, not a citation. At most 200 citations
 * are parsed; the rest is text. The scanner is a hand-written single pass (no regular
 * expression): each attempt reads at most one citation's length, so the cost is linear in the
 * text with a constant bounded by the quote cap. Published: never edit. A change ships with a
 * new template and kit version.
 */

import { LIMITS } from '../limits'

export type Segment =
  | { kind: 'text'; text: string }
  /** `start`/`end` are UTF-16 offsets in the original text; `raw` is `text.slice(start, end)`. */
  | { kind: 'cite'; raw: string; sources: number[]; quote: string | null; start: number; end: number }

export type CiteSegment = Extract<Segment, { kind: 'cite' }>

const G = LIMITS.grounded

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t'
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9'
}

/** Line feed, carriage return, next line, line and paragraph separators. */
const LINE_BREAK_CODES = new Set([0x0a, 0x0d, 0x85, 0x2028, 0x2029])

function isLineBreak(char: string): boolean {
  return LINE_BREAK_CODES.has(char.charCodeAt(0))
}

/** Reads one citation starting at `start` (a "["), or returns null. */
function readCitation(text: string, start: number): { end: number; sources: number[]; quote: string | null } | null {
  let i = start + 1
  const skipSpace = () => {
    while (isSpace(text[i])) i++
  }
  const readRef = (): number | null => {
    if (text[i] !== 'S' && text[i] !== 's') return null
    if (!isDigit(text[i + 1])) return null
    let value = Number(text[i + 1])
    let j = i + 2
    if (isDigit(text[j])) {
      value = value * 10 + Number(text[j])
      j++
    }
    if (isDigit(text[j])) return null
    i = j
    return value
  }

  skipSpace()
  const first = readRef()
  if (first === null) return null
  const sources = [first]
  for (;;) {
    const save = i
    skipSpace()
    if (text[i] !== ',') {
      i = save
      break
    }
    i++
    skipSpace()
    const next = readRef()
    if (next === null) return null
    sources.push(next)
  }
  skipSpace()
  let quote: string | null = null
  if (text[i] === ':') {
    i++
    skipSpace()
    const open = text[i]
    const close = open === '"' ? '"' : open === '“' ? '”' : null
    if (close === null) return null
    i++
    const quoteStart = i
    let count = 0
    while (i < text.length && text[i] !== close) {
      if (isLineBreak(text[i])) return null
      const code = text.codePointAt(i)!
      i += code > 0xffff ? 2 : 1
      count++
      if (count > G.citationQuote.max) return null
    }
    if (i >= text.length || count < G.citationQuote.min) return null
    quote = text.slice(quoteStart, i)
    i++
    skipSpace()
  }
  if (text[i] !== ']') return null
  // `[S1](https://…)` is a markdown link that happens to look like a citation.
  if (text[i + 1] === '(') return null
  return { end: i + 1, sources, quote }
}

/** Splits a testimony into text and citations. Concatenating every `text` and `raw` gives the input back. */
export function parseCitations(text: string): Segment[] {
  const out: Segment[] = []
  let textStart = 0
  let from = 0
  let count = 0
  while (from < text.length && count < G.maxCitationsParsed) {
    const at = text.indexOf('[', from)
    if (at < 0) break
    const cite = readCitation(text, at)
    if (!cite) {
      from = at + 1
      continue
    }
    if (at > textStart) out.push({ kind: 'text', text: text.slice(textStart, at) })
    out.push({ kind: 'cite', raw: text.slice(at, cite.end), sources: cite.sources, quote: cite.quote, start: at, end: cite.end })
    count++
    from = textStart = cite.end
  }
  if (textStart < text.length) out.push({ kind: 'text', text: text.slice(textStart) })
  return out
}

export function citationsOf(text: string): CiteSegment[] {
  return parseCitations(text).filter((segment): segment is CiteSegment => segment.kind === 'cite')
}
