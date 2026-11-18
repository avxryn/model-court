/**
 * The results headline, computed only from scores already on the record: per
 * question, each party's score is its three rubric lines summed (0–6),
 * averaged over the raters. The jury is the source when any juror scored;
 * otherwise the judge's own review is, and the two are never combined. This
 * is a count, not a judgment, and it names no winner when the count is close.
 */

import { DIMENSIONS } from '@/domain/rubric'
import type { ResultsView } from '@/lib/dto'

const EPSILON = 1e-9
const LINE_MAX = 2

export interface TallyJudgment {
  reviewer: string
  configurationKey: string
  correctness: number | null
  completeness: number | null
  grounding: number | null
}

export interface TallyQuestionInput {
  key: string
  /** Position in the record (Q1, Q2…), shared with the testimony list. */
  number: number
  title: string
  judgments: ReadonlyArray<TallyJudgment>
}

export interface QuestionTally {
  key: string
  number: number
  title: string
  /** Mean points per party for this question, 0–6. */
  scores: Record<string, number>
  /** The party with the unique top score, or null when the top is shared. */
  winner: string | null
  /** Top score minus the next one; 0 when tied. */
  margin: number
}

export interface PartyTally {
  key: string
  label: string
  wins: number
  ties: number
  losses: number
  total: number
}

export type HeadlineOutcome = 'lead' | 'close' | 'tie' | 'none'

export interface Tally {
  outcome: HeadlineOutcome
  /** The party named as ahead; set only when the outcome is 'lead'. */
  leader: string | null
  /** Distinct raters behind these numbers. */
  raters: number
  questions: QuestionTally[]
  /** In the record's party order. */
  parties: PartyTally[]
  /** Questions where the top score was shared. */
  tied: number
  /** Decided questions won by one point or less, in record order. */
  close: QuestionTally[]
  maxPerQuestion: number
  maxTotal: number
  /** Highest total minus the next one. */
  totalMargin: number
  /** The party with the unique highest total, or null when totals tie. */
  totalLeader: string | null
  sentence: string
}

const same = (a: number, b: number) => Math.abs(a - b) < EPSILON

/** Whole numbers as-is; jury means to one decimal. */
export function formatPoints(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function topOf<T>(items: readonly T[], value: (item: T) => number): { top: T[]; margin: number } {
  if (items.length === 0) return { top: [], margin: 0 }
  const values = items.map(value)
  const best = Math.max(...values)
  const top = items.filter((_, i) => same(values[i], best))
  const rest = values.filter((v) => !same(v, best))
  return { top, margin: rest.length ? best - Math.max(...rest) : 0 }
}

function questionScores(question: TallyQuestionInput, partyKeys: readonly string[]): Record<string, number> | null {
  const scores: Record<string, number> = {}
  for (const key of partyKeys) {
    const sums = question.judgments
      .filter((j) => j.configurationKey === key)
      .map((j) => DIMENSIONS.map((d) => j[d]))
      .filter((lines): lines is number[] => lines.every((s) => s !== null))
      .map((lines) => lines.reduce((a, b) => a + b, 0))
    if (sums.length === 0) return null
    scores[key] = sums.reduce((a, b) => a + b, 0) / sums.length
  }
  return scores
}

function listAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** The tally over the given questions. Questions where a party has no complete rating are left out. */
export function tallyQuestions(parties: ReadonlyArray<{ key: string; label: string }>, input: ReadonlyArray<TallyQuestionInput>): Tally {
  const keys = parties.map((p) => p.key)
  const label = (key: string) => parties.find((p) => p.key === key)?.label ?? key
  const raters = new Set<string>()
  const questions: QuestionTally[] = []
  for (const question of input) {
    const scores = questionScores(question, keys)
    if (!scores) continue
    question.judgments.forEach((j) => raters.add(j.reviewer))
    const { top, margin } = topOf(keys, (key) => scores[key])
    questions.push({ key: question.key, number: question.number, title: question.title, scores, winner: top.length === 1 ? top[0] : null, margin: top.length === 1 ? margin : 0 })
  }

  const partyTallies: PartyTally[] = parties.map((p) => {
    let wins = 0
    let ties = 0
    let losses = 0
    for (const q of questions) {
      const best = Math.max(...keys.map((k) => q.scores[k]))
      if (q.winner === p.key) wins += 1
      else if (q.winner === null && same(q.scores[p.key], best)) ties += 1
      else losses += 1
    }
    return { key: p.key, label: p.label, wins, ties, losses, total: questions.reduce((sum, q) => sum + q.scores[p.key], 0) }
  })

  const maxPerQuestion = DIMENSIONS.length * LINE_MAX
  const tied = questions.filter((q) => q.winner === null).length
  const close = questions.filter((q) => q.winner !== null && q.margin <= 1 + EPSILON)
  const byTotal = topOf(partyTallies, (p) => p.total)
  const byWins = topOf(partyTallies, (p) => p.wins)
  const totalLeader = byTotal.top.length === 1 ? byTotal.top[0].key : null
  const base = { raters: raters.size, questions, parties: partyTallies, tied, close, maxPerQuestion, maxTotal: maxPerQuestion * questions.length, totalMargin: byTotal.margin, totalLeader }

  const n = questions.length
  const others = (except: string | null) =>
    partyTallies
      .filter((p) => p.key !== except && p.wins > 0)
      .map((p) => `${p.label} won ${p.wins}`)
  const tiedText = tied > 0 ? `${tied} tied` : null

  if (n === 0) return { ...base, outcome: 'none', leader: null, sentence: 'No scores yet.' }

  if (tied === n) {
    const who = parties.length === 2 ? 'both parties' : 'every party'
    return { ...base, outcome: 'tie', leader: null, sentence: n === 1 ? `A tie: the question scored the same for ${who}.` : `A tie: all ${n} questions scored the same for ${who}.` }
  }

  const winsLeader = byWins.top.length === 1 ? byWins.top[0] : null
  const winsGap = byWins.margin
  if (!winsLeader && !totalLeader) {
    const each = byWins.top.length === partyTallies.length ? `each party won ${byWins.top[0].wins} of ${n} questions` : `${listAnd(byWins.top.map((p) => p.label))} each won ${byWins.top[0].wins} of ${n} questions`
    return { ...base, outcome: 'tie', leader: null, sentence: `A tie: ${each}${tiedText ? `, ${tiedText},` : ''} and the totals are equal.` }
  }

  const counts = [...partyTallies.filter((p) => p.wins > 0).sort((a, b) => b.wins - a.wins).map((p, i) => (i === 0 ? `${p.label} won ${p.wins} of ${n} questions` : `${p.label} won ${p.wins}`)), ...(tiedText ? [tiedText] : [])]
  const disagree = winsLeader && totalLeader && winsLeader.key !== totalLeader
  if (!winsLeader || winsGap <= 1 || disagree || !totalLeader) {
    let sentence = `Too close to call: ${listAnd(counts)}.`
    if (!winsLeader && totalLeader) sentence += ` ${label(totalLeader)} scored more points overall.`
    else if (disagree) sentence += ` But ${label(totalLeader)} scored more points overall.`
    else if (!totalLeader) sentence += ' The point totals are equal.'
    return { ...base, outcome: 'close', leader: null, sentence }
  }

  const rest = [...others(winsLeader.key), ...(tiedText ? [tiedText] : [])]
  return { ...base, outcome: 'lead', leader: winsLeader.key, sentence: `${winsLeader.label} won ${winsLeader.wins} of ${n} questions${rest.length ? `; ${rest.join('; ')}` : ''}.` }
}

export type TallySource = 'jury' | 'judge' | 'none'

/**
 * The record's headline: the jury's scores when any juror scored, otherwise
 * the judge's own review (a solo case). Never a mix of the two.
 */
export function recordTally(data: Pick<ResultsView, 'cases' | 'configurations'>): Tally & { source: TallySource } {
  const scored = data.cases.map((c, index) => ({ c, number: index + 1 })).filter(({ c }) => c.eligible)
  const pick = (jury: boolean) => scored.map(({ c, number }) => ({ key: c.key, number, title: c.title, judgments: c.judgments.filter((j) => (j.contextType === 'owner') !== jury) }))
  const jury = tallyQuestions(data.configurations, pick(true))
  if (jury.raters > 0) return { ...jury, source: 'jury' }
  const judge = tallyQuestions(data.configurations, pick(false))
  if (judge.raters > 0) return { ...judge, source: 'judge' }
  return { ...jury, source: 'none' }
}
