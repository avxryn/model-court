/**
 * Quote and refusal matching for `grounded-v1` (spec 05 §8, D-92). Pure and browser-safe: the
 * checks use it on the server, and the record uses it after unsealing to highlight where a quote
 * was found. Published: never edit a V1 function; a change ships as V2 with a new kit version.
 *
 * Normalization (`normalizeQuoteV1`): each character with its combining marks is put in NFKC and
 * lower case; curly quotes and dashes become ASCII; `*`, `_` and `` ` `` are dropped (markdown
 * emphasis); every whitespace run becomes one space; the result is trimmed. It keeps, for each
 * normalized UTF-16 unit, the span of the original it came from, so a match maps back.
 */

const QUOTES_AND_DASHES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '―': '-',
  '−': '-',
}

const EMPHASIS = new Set(['*', '_', '`'])
const WHITESPACE = /\s/u
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
/** One character with the combining marks after it (or a run of leading marks). */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gsu

export interface NormalizedText {
  text: string
  /** For normalized unit k: the original offset where its character starts and ends. */
  starts: number[]
  ends: number[]
}

export function normalizeQuoteV1(value: string): NormalizedText {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  let pendingSpace: { start: number; end: number } | null = null
  const push = (piece: string, start: number, end: number) => {
    for (let k = 0; k < piece.length; k++) {
      starts.push(start)
      ends.push(end)
    }
    text += piece
  }
  for (const match of value.matchAll(CLUSTER)) {
    const start = match.index
    const end = start + match[0].length
    for (const char of match[0].normalize('NFKC').toLowerCase()) {
      if (EMPHASIS.has(char)) continue
      if (WHITESPACE.test(char)) {
        if (text.length > 0 && pendingSpace === null) pendingSpace = { start, end }
        continue
      }
      if (pendingSpace) {
        push(' ', pendingSpace.start, pendingSpace.end)
        pendingSpace = null
      }
      push(QUOTES_AND_DASHES[char] ?? char, start, end)
    }
  }
  return { text, starts, ends }
}

export interface Span {
  start: number
  end: number
}

/** A quote's fragments: split at `...` (NFKC turns `…` into `...`), trimmed, empty ones dropped. */
export function quoteFragmentsV1(quote: string): string[] {
  return normalizeQuoteV1(quote)
    .text.split('...')
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0)
}

/**
 * Where a quote appears in a source: one span of the original source per fragment, in order, or
 * null when any fragment is missing (or the quote is only an ellipsis).
 */
export function findQuoteV1(source: string | NormalizedText, quote: string): Span[] | null {
  const haystack = typeof source === 'string' ? normalizeQuoteV1(source) : source
  const fragments = quoteFragmentsV1(quote)
  if (fragments.length === 0) return null
  const spans: Span[] = []
  let from = 0
  for (const fragment of fragments) {
    const at = haystack.text.indexOf(fragment, from)
    if (at < 0) return null
    spans.push({ start: haystack.starts[at], end: haystack.ends[at + fragment.length - 1] })
    from = at + fragment.length
  }
  return spans
}

/** The fixed "not in the sources" sentence of `grounded-v1` (spec 05 §6.1). */
export const NOT_IN_SOURCES = 'The sources do not contain the answer.'

const REFUSAL_NEEDLE = normalizeQuoteV1(NOT_IN_SOURCES.replace(/\.$/u, '')).text

/** Whether the answer contains the fixed sentence (normalized; the trailing period optional; not inside a longer word). */
export function containsRefusalV1(answer: string): boolean {
  const haystack = normalizeQuoteV1(answer).text
  let from = 0
  for (;;) {
    const at = haystack.indexOf(REFUSAL_NEEDLE, from)
    if (at < 0) return false
    const before = at > 0 ? haystack[at - 1] : undefined
    const after = haystack.codePointAt(at + REFUSAL_NEEDLE.length)
    const wordBefore = before !== undefined && LETTER_OR_DIGIT.test(before)
    const wordAfter = after !== undefined && LETTER_OR_DIGIT.test(String.fromCodePoint(after))
    if (!wordBefore && !wordAfter) return true
    from = at + 1
  }
}
