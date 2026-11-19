/**
 * How a testimony's citations render (spec 05 §3, §7.1, D-96). Pure, and a function of the
 * testimony text and the number of sources only, so every party renders the same way, imported
 * answers included. Jurors get chips, never a match result; quote findings (`quoteFindings`) are
 * check facts and are used only on the unsealed record.
 */

import { parseCitations } from '@/domain/grounded/citations'
import { findQuoteV1, type Span } from '@/domain/grounded/match'

export type CitedPart =
  | { kind: 'text'; text: string }
  /** A quoted passage the party attributed to its sources (shown as a quotation, unchecked). */
  | { kind: 'quote'; text: string }
  /** A cited source: a chip when it exists, plain text when it doesn't. */
  | { kind: 'ref'; number: number; exists: boolean; first: boolean; last: boolean }

/** The testimony split into lines (as `Testimony` splits them), each a list of parts. */
export function citedLines(text: string, sourceCount: number): CitedPart[][] {
  const lines: CitedPart[][] = [[]]
  const pushText = (value: string) => {
    const pieces = value.split('\n')
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push([])
      if (piece !== '') lines[lines.length - 1].push({ kind: 'text', text: piece })
    })
  }
  for (const segment of parseCitations(text)) {
    if (segment.kind === 'text') {
      pushText(segment.text)
      continue
    }
    const line = lines[lines.length - 1]
    if (!segment.sources.some((n) => n >= 1 && n <= sourceCount)) {
      // A citation to nothing that exists stays exactly as the party wrote it.
      line.push({ kind: 'text', text: segment.raw })
      continue
    }
    if (segment.quote !== null) line.push({ kind: 'quote', text: segment.quote })
    segment.sources.forEach((number, index) => line.push({ kind: 'ref', number, exists: number >= 1 && number <= sourceCount, first: index === 0, last: index === segment.sources.length - 1 }))
  }
  return lines
}

export interface QuoteFinding {
  quote: string
  /** The cited numbers, as written. */
  cited: number[]
  /** The first cited source that contains it, or null. */
  foundIn: number | null
  spans: Span[]
}

/** Unsealed record only: where each quote was found (the same rule as the `quotes-match` check). */
export function quoteFindings(text: string, sources: ReadonlyArray<{ number: number; text: string }>): QuoteFinding[] {
  const out: QuoteFinding[] = []
  for (const segment of parseCitations(text)) {
    if (segment.kind !== 'cite' || segment.quote === null) continue
    let foundIn: number | null = null
    let spans: Span[] = []
    for (const number of segment.sources) {
      const source = sources.find((candidate) => candidate.number === number)
      const found = source ? findQuoteV1(source.text, segment.quote) : null
      if (found) {
        foundIn = number
        spans = found
        break
      }
    }
    out.push({ quote: segment.quote, cited: segment.sources, foundIn, spans })
  }
  return out
}

/** Merged, sorted spans, so overlapping highlights render once. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const out: Span[] = []
  for (const span of sorted) {
    const last = out.at(-1)
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else out.push({ ...span })
  }
  return out
}

/** The text cut at the spans: [plain, marked, plain, …]. */
export function splitAtSpans(text: string, spans: readonly Span[]): Array<{ text: string; marked: boolean }> {
  const out: Array<{ text: string; marked: boolean }> = []
  let at = 0
  for (const span of mergeSpans(spans)) {
    if (span.start > at) out.push({ text: text.slice(at, span.start), marked: false })
    out.push({ text: text.slice(span.start, span.end), marked: true })
    at = span.end
  }
  if (at < text.length) out.push({ text: text.slice(at), marked: false })
  return out
}
