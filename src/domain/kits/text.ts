/**
 * Shared, versioned text helpers for kit checks (spec 03 §5.4, §6.4; D-75). Pure.
 *
 * A published kit's check results must never change, so every helper here carries a version
 * suffix: a fix ships as a new function (`countWordsV2`) used by a new kit version, never as an
 * edit to a V1 helper. `kit-versions.test.ts` pins their outputs on fixed inputs.
 *
 * Matching is linear-time by construction: judge-supplied phrases are compared literally with
 * `indexOf` plus boundary checks and are never compiled into a regular expression, and our own
 * fixed patterns have no nested quantifiers.
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
const WHITESPACE_RUN = /\s+/u
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
/** Scripts written without spaces between words: a phrase may sit between any two of their characters. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u

/**
 * v1 normalization for matching: NFKC, lower case, curly quotes and dashes to ASCII, `*`, `_`
 * and `` ` `` removed, every whitespace run to one space, trimmed.
 */
export function normalizeForMatchV1(value: string): string {
  let out = ''
  let pendingSpace = false
  for (const char of value.normalize('NFKC').toLowerCase()) {
    if (EMPHASIS.has(char)) continue
    if (WHITESPACE.test(char)) {
      pendingSpace = out.length > 0
      continue
    }
    if (pendingSpace) {
      out += ' '
      pendingSpace = false
    }
    out += QUOTES_AND_DASHES[char] ?? char
  }
  return out
}

/** A character that joins words: a letter or digit of a script that separates words with spaces. */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && LETTER_OR_DIGIT.test(char) && !UNSPACED_SCRIPT.test(char)
}

function charBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined
  const low = text.charCodeAt(index - 1)
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) return text.slice(index - 2, index)
  return text[index - 1]
}

function charAt(text: string, index: number): string | undefined {
  if (index >= text.length) return undefined
  const code = text.codePointAt(index)
  return code === undefined ? undefined : String.fromCodePoint(code)
}

function lastChar(text: string): string | undefined {
  return charBefore(text, text.length)
}

/**
 * v1 literal phrase match on normalized text. Where the phrase starts (or ends) with a letter
 * or digit, the text must not continue the word on that side, so "refund" does not match
 * "refunds". Characters of unspaced scripts (Chinese, Japanese, Thai, …) are never treated as
 * continuing a word, so a phrase can match inside them.
 */
export function containsPhraseV1(text: string, phrase: string): boolean {
  const haystack = normalizeForMatchV1(text)
  const needle = normalizeForMatchV1(phrase)
  return containsNormalizedV1(haystack, needle)
}

/** containsPhraseV1 on text and phrase that are already normalized (for checking many phrases against one text). */
export function containsNormalizedV1(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false
  const startsWord = isWordChar(charAt(needle, 0))
  const endsWord = isWordChar(lastChar(needle))
  let from = 0
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from)
    if (index < 0) return false
    const before = charBefore(haystack, index)
    const after = charAt(haystack, index + needle.length)
    if ((!startsWord || !isWordChar(before)) && (!endsWord || !isWordChar(after))) return true
    from = startsWord ? endOfWordRun(haystack, index) : index + 1
  }
  return false
}

/**
 * The first position after the run of word characters starting at `index`. A phrase that starts
 * with a word character can only match where no word character precedes it, so every start inside
 * this run is skipped at once. This keeps the scan linear (D-80: "aaaa…" against "aaa…a" used to
 * retry at every character). Results are unchanged.
 */
function endOfWordRun(text: string, index: number): number {
  let position = index
  while (position < text.length) {
    const char = charAt(text, position)
    if (!isWordChar(char)) return position
    position += char!.length
  }
  return position
}

/** A line-initial ordered-list marker such as `1.` or `2)` (digits, then one `.` or `)`). */
function isListMarker(segment: string): boolean {
  if (segment.length < 2) return false
  const last = segment[segment.length - 1]
  if (last !== '.' && last !== ')') return false
  for (let i = 0; i < segment.length - 1; i++) if (!isDigit(segment[i])) return false
  return true
}

/**
 * v1 word count: whitespace-separated segments that contain at least one letter or digit.
 * Bullet dashes and a line-initial numbering marker (`1.`, `2)`) are not words.
 */
export function countWordsV1(text: string): number {
  let count = 0
  for (const line of splitLinesV1(text)) {
    let first = true
    for (const segment of line.split(WHITESPACE_RUN)) {
      if (segment.length === 0) continue
      const marker = first && isListMarker(segment)
      first = false
      if (marker) continue
      if (LETTER_OR_DIGIT.test(segment)) count++
    }
  }
  return count
}

/** v1 character count: code points, excluding whitespace. */
export function countCharactersV1(text: string): number {
  let count = 0
  for (const char of text) if (!WHITESPACE.test(char)) count++
  return count
}

/** v1 line split on CR LF, CR or LF. */
export function splitLinesV1(text: string): string[] {
  return text.split(/\r\n|\r|\n/u)
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9'
}

/**
 * v1 number extraction: digit runs with optional `,` or `.` groups (`1,000`, `1.5`, `12`), each
 * returned with thousands separators removed. A line-initial ordered-list marker (`1.` or `2)`
 * followed by a space or the end of the line) is not a number. Spelled-out numbers ("three")
 * are not found. A hand-written scanner, so there is no pattern to backtrack.
 */
export function extractNumbersV1(text: string): string[] {
  const numbers: string[] = []
  for (const line of splitLinesV1(text)) {
    let index = 0
    // Skip a line-initial list marker.
    let start = 0
    while (start < line.length && (line[start] === ' ' || line[start] === '\t')) start++
    let end = start
    while (isDigit(line[end])) end++
    if (end > start && (line[end] === '.' || line[end] === ')') && (end + 1 >= line.length || line[end + 1] === ' ' || line[end + 1] === '\t')) {
      index = end + 1
    }
    while (index < line.length) {
      if (!isDigit(line[index])) {
        index++
        continue
      }
      let token = ''
      while (index < line.length) {
        if (isDigit(line[index])) {
          token += line[index]
          index++
        } else if ((line[index] === ',' || line[index] === '.') && isDigit(line[index + 1]) && token.length > 0) {
          token += line[index]
          index++
        } else {
          break
        }
      }
      numbers.push(token.replaceAll(',', ''))
    }
  }
  return numbers
}

const LABEL_STRIP = new Set(['*', '`', '"', "'", '‘', '’', '“', '”'])

/** v1 label normalization: NFKC, trim, collapse spaces, case-fold, strip `*`, `` ` ``, quotes and a trailing `.`. */
export function normalizeLabelV1(value: string): string {
  let out = ''
  for (const char of value.normalize('NFKC')) if (!LABEL_STRIP.has(char)) out += char
  out = out.trim().replace(/\s+/gu, ' ').toLowerCase()
  if (out.endsWith('.')) out = out.slice(0, -1).trimEnd()
  return out
}
