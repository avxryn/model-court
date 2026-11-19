/**
 * Sources of a grounded question (spec 05 §4, D-92). Pure and browser-safe, except that hashing
 * uses Web Crypto (available in the Worker, the browser and Node).
 *
 * A source is `{number, title, origin, text}`: `number` is its 1-based position, `title` and
 * `origin` may be null. Its fingerprint is the SHA-256 of the canonical JSON of all four, so the
 * question hash and the snapshot hash (through `kitFields.sources`) commit to the exact bytes.
 * `origin` is the judge's note: never sent to a provider and never shown to jurors.
 */

import { canonicalJson, sha256Hex } from '../canonical'
import { LIMITS } from '../limits'
import { codePointLength, utf8ByteLength } from '../text'

export interface GroundedSource {
  number: number
  title: string | null
  origin: string | null
  text: string
}

/** What a provider and a check may see of a source: never the origin. */
export interface PromptSource {
  number: number
  title: string | null
  text: string
}

export interface SourceRef {
  number: number
  sha256: string
  byteLength: number
}

export function sourceSha256(source: GroundedSource): Promise<string> {
  return sha256Hex(canonicalJson({ number: source.number, title: source.title, origin: source.origin, text: source.text }))
}

export async function sourceRefOf(source: GroundedSource): Promise<SourceRef> {
  return { number: source.number, sha256: await sourceSha256(source), byteLength: utf8ByteLength(source.text) }
}

export function promptSourcesOf(sources: ReadonlyArray<Pick<GroundedSource, 'number' | 'title' | 'text'>>): PromptSource[] {
  return sources.map((source) => ({ number: source.number, title: source.title, text: source.text }))
}

/** Code points of source text. */
export function sourceChars(sources: ReadonlyArray<Pick<GroundedSource, 'text'>>): number {
  return sources.reduce((sum, source) => sum + codePointLength(source.text), 0)
}

/** "S1, S3 and S4". */
export function sourceList(numbers: readonly number[]): string {
  const names = numbers.map((n) => `S${n}`)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Minutes of reading for a juror at 250 words a minute (spec 05 §10), at least 1 when there is text. */
export function readingMinutes(texts: readonly string[]): number {
  const words = texts.reduce((sum, text) => sum + (text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0), 0)
  return words === 0 ? 0 : Math.max(1, Math.round(words / LIMITS.grounded.readingWordsPerMinute))
}

/** The grounding key in words, for the jury instructions (spec 05 §3, juror step 1). */
export function groundingKeyText(key: { answerable: 'yes' | 'partly' | 'no'; requiredSources: readonly number[] }): string {
  const how = key.answerable === 'yes' ? 'the sources answer it' : key.answerable === 'partly' ? 'the sources answer it in part' : 'the sources do not answer it'
  const cites = key.answerable !== 'no' && key.requiredSources.length > 0 ? ` A good answer cites ${sourceList(key.requiredSources)}.` : ''
  return `The judge marked this question: ${how}.${cites}`
}
