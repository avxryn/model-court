/**
 * How consistent a setup is across repeated samples of the same question (spec 01 §5.4, D-66).
 * Pure and browser-safe. Wording overlap compares characters, not meaning, so the record
 * always tells the reader to read the samples before concluding anything.
 */

import { median } from './setup-metrics'

export interface SampleText {
  status: string
  text: string | null
  outputTokens: number | null
  durationMs: number | null
}

export interface QuestionSamples {
  caseKey: string
  /** Samples planned for this question (the hearing's samples per answer). */
  planned: number
  samples: readonly SampleText[]
}

export interface QuestionConsistency {
  caseKey: string
  /** Succeeded samples with text. */
  n: number
  /** Every pair identical after normalization; null with fewer than two answers. */
  same: boolean | null
  /** Mean pairwise Jaccard similarity of character 3-gram sets, 0–1; null with fewer than two answers. */
  overlap: number | null
  /** (max − min) / median of output tokens; null when fewer than two are known. */
  lengthSpread: number | null
  answeredEveryTime: boolean
}

export interface ConsistencyMetrics {
  /** Questions with at least two answers to compare. */
  compared: number
  /** Of those, how many gave the same answer every time. */
  sameAnswer: number
  medianOverlap: number | null
  /** Questions where every planned sample succeeded, of `planned`. */
  answeredEveryTime: number
  planned: number
  medianLengthSpread: number | null
  /** Slowest / median duration across all succeeded samples; null with fewer than two. */
  latencySpread: number | null
  /** Filled by later task kits from their own consistency key (spec 01 §10). */
  byKit?: { agreement: number; key: string }
  questions: QuestionConsistency[]
}

/** Unicode NFC, trimmed, whitespace runs collapsed to one space. */
export function normalizeAnswer(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

/** Character 3-grams (by code point) of the lowercased normalized text; a shorter text is its own gram. */
export function trigrams(text: string): Set<string> {
  const chars = [...normalizeAnswer(text).toLowerCase()]
  if (chars.length === 0) return new Set()
  if (chars.length < 3) return new Set([chars.join('')])
  const grams = new Set<string>()
  for (let i = 0; i + 3 <= chars.length; i++) grams.add(chars.slice(i, i + 3).join(''))
  return grams
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared++
  return shared / (a.size + b.size - shared)
}

function pairs<T>(items: readonly T[]): Array<[T, T]> {
  const out: Array<[T, T]> = []
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push([items[i], items[j]])
  return out
}

export function questionConsistency(question: QuestionSamples): QuestionConsistency {
  const answered = question.samples.filter((sample): sample is SampleText & { text: string } => sample.status === 'succeeded' && sample.text !== null)
  const normalized = answered.map((sample) => normalizeAnswer(sample.text))
  const grams = answered.map((sample) => trigrams(sample.text))
  const tokenCounts = answered.map((sample) => sample.outputTokens).filter((value): value is number => value !== null)
  const comparable = answered.length >= 2
  const middle = median(tokenCounts)
  return {
    caseKey: question.caseKey,
    n: answered.length,
    same: comparable ? normalized.every((text) => text === normalized[0]) : null,
    overlap: comparable ? pairs(grams).reduce((sum, [a, b]) => sum + jaccard(a, b), 0) / pairs(grams).length : null,
    lengthSpread: tokenCounts.length >= 2 && middle ? (Math.max(...tokenCounts) - Math.min(...tokenCounts)) / middle : null,
    answeredEveryTime: question.samples.length >= question.planned && question.samples.every((sample) => sample.status === 'succeeded'),
  }
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** A party's consistency across every question of the hearing. */
export function consistencyMetrics(questions: readonly QuestionSamples[]): ConsistencyMetrics {
  const per = questions.map(questionConsistency)
  const compared = per.filter((q) => q.same !== null)
  const durations = questions.flatMap((q) => q.samples.filter((s) => s.status === 'succeeded' && s.durationMs !== null).map((s) => s.durationMs!))
  const typical = median(durations)
  return {
    compared: compared.length,
    sameAnswer: compared.filter((q) => q.same).length,
    medianOverlap: medianOf(compared.map((q) => q.overlap!)),
    answeredEveryTime: per.filter((q) => q.answeredEveryTime).length,
    planned: questions.length,
    medianLengthSpread: medianOf(per.flatMap((q) => (q.lengthSpread === null ? [] : [q.lengthSpread]))),
    latencySpread: durations.length >= 2 && typical ? Math.max(...durations) / typical : null,
    questions: per,
  }
}
