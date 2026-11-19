/**
 * Plain-language text for the record's "Cost and speed" section (D-63). Pure, so the
 * sentence and cell text are unit- and render-tested without a server. The sentence
 * never names a winner the headline does not.
 */

import { MODEL_ROUTES, PROVIDER_NAMES, type ProviderId } from '@/domain/registry'
import { formatMicroUsd, type PartyMetrics } from '@/domain/setup-metrics'
import { formatDuration, plural } from '@/lib/format'
import type { Tally } from './headline'

export interface SetupRow {
  key: string
  label: string
  /** "OpenAI · gpt-6-luna", or the imported source. */
  source: string
  /** The route always reasons and bills reasoning as output (D-48). */
  reasoning: boolean
  metrics: PartyMetrics
}

/** Short names for the table; full explanations stay in `ERROR_TEXT`. */
export const ERROR_SHORT: Record<string, string> = {
  PROVIDER_AUTH_FAILED: 'key rejected',
  PROVIDER_ACCESS_DENIED: 'no model access',
  PROVIDER_MODEL_UNAVAILABLE: 'model unavailable',
  PROVIDER_QUOTA_EXHAUSTED: 'out of credit',
  PROVIDER_RATE_LIMITED: 'rate limited',
  PROVIDER_UNAVAILABLE: 'provider unavailable',
  PROVIDER_REJECTED_REQUEST: 'request rejected',
  PROVIDER_SCHEMA_REJECTED: 'field list refused',
  PROVIDER_DOCUMENT_REJECTED: 'PDF refused',
  PROVIDER_BLOCKED: 'blocked',
  PROVIDER_REDIRECT_REFUSED: 'redirect refused',
  PROVIDER_TIMEOUT: 'timed out',
  PROVIDER_NETWORK_ERROR: 'connection failed',
  PROVIDER_CANCELED: 'canceled mid-call',
  PROVIDER_LEASE_EXPIRED: 'worker stopped',
  INVALID_PROVIDER_RESPONSE: 'unreadable response',
  OUTPUT_TOO_LARGE: 'answer too large',
  EMPTY_OUTPUT: 'empty answer',
  CREDENTIAL_REVOKED: 'key removed',
  CREDENTIAL_EXPIRED: 'key expired',
  CREDENTIAL_UNAVAILABLE: 'key unusable',
  DELETED: 'case deleted',
}

export function isReasoningRoute(provider: ProviderId | null, modelId: string | null): boolean {
  if (!provider || !modelId) return false
  return MODEL_ROUTES.find((route) => route.provider === provider && route.modelId === modelId)?.reasoning === 'low'
}

export function setupRows(data: {
  configurations: ReadonlyArray<{ key: string; label: string; provider: ProviderId | null; modelId: string | null; source?: 'imported' }>
  setupMetrics: Record<string, PartyMetrics>
}, sourceOf: (c: { provider: ProviderId | null; modelId: string | null }) => string): SetupRow[] {
  return data.configurations
    .filter((c) => data.setupMetrics[c.key])
    .map((c) => ({ key: c.key, label: c.label, source: sourceOf(c), reasoning: isReasoningRoute(c.provider, c.modelId), metrics: data.setupMetrics[c.key] }))
}

export function costPerAnswer(m: PartyMetrics): string {
  if (m.cost.status === 'no_price') return 'No price on file for this model'
  if (m.cost.perAnswerMedianMicroUsd === null) return 'Unknown'
  return formatMicroUsd(m.cost.perAnswerMedianMicroUsd)
}

export function costHearing(m: PartyMetrics): string {
  if (m.cost.status === 'no_price') return 'No price on file'
  const unknown = m.cost.possiblyBilledUnknown
  const known = m.cost.hearingMicroUsd === null ? 'Unknown' : formatMicroUsd(m.cost.hearingMicroUsd)
  return unknown > 0 ? `${known} + ${plural(unknown, 'call')} of unknown cost` : known
}

export function costPerThousand(m: PartyMetrics): string {
  if (m.cost.status === 'no_price') return '—'
  return m.cost.perThousandMicroUsd === null ? 'Unknown' : formatMicroUsd(m.cost.perThousandMicroUsd)
}

export function speed(m: PartyMetrics): string {
  if (m.latency.n === 0) return '—'
  return `${formatDuration(m.latency.medianMs)} / ${formatDuration(m.latency.slowestMs)}`
}

const count = (value: number) => value.toLocaleString('en-US')

export function tokensPerAnswer(row: SetupRow): { main: string; note: string | null } {
  const t = row.metrics.tokens
  if (t.medianInput === null || t.medianOutput === null) return { main: '—', note: t.unknownUsage > 0 ? `${plural(t.unknownUsage, 'answer')} without usage` : null }
  const share = t.totalReasoning !== null && t.totalOutput > 0 ? Math.round((t.totalReasoning / t.totalOutput) * 100) : null
  const note = row.reasoning ? (share !== null ? `out includes reasoning (${share}%)` : 'out includes reasoning') : share !== null && share > 0 ? `${share}% of output was reasoning` : null
  return { main: `${count(t.medianInput)} in / ${count(t.medianOutput)} out`, note }
}

/** "Same answer 3 of 5 · wording overlap 82% · answered every time 5 of 5" (D-66). */
export function consistency(m: PartyMetrics): string {
  const c = m.consistency
  if (!c) return '—'
  const parts = [c.compared > 0 ? `Same answer ${c.sameAnswer} of ${c.compared}` : 'Too few answers to compare']
  if (c.medianOverlap !== null) parts.push(`wording overlap ${Math.round(c.medianOverlap * 100)}%`)
  parts.push(`answered every time ${c.answeredEveryTime} of ${c.planned}`)
  return parts.join(' · ')
}

export function failures(m: PartyMetrics): string {
  const codes = Object.entries(m.calls.errorCodes).sort(([, a], [, b]) => b - a)
  const failedCalls = codes.reduce((sum, [, n]) => sum + n, 0)
  const parts: string[] = []
  // Calls that failed or timed out, with why; "uncertain" counts answers still without a known outcome.
  if (failedCalls > 0) parts.push(`${plural(failedCalls, 'failed call')} (${codes.map(([code, n]) => `${ERROR_SHORT[code] ?? code.toLowerCase().replaceAll('_', ' ')}${n > 1 ? ` ×${n}` : ''}`).join(', ')})`)
  parts.push(`${m.calls.retries} retried`)
  parts.push(`${m.calls.uncertain} uncertain`)
  if (failedCalls === 0 && m.calls.retries === 0 && m.calls.uncertain === 0) return 'None'
  return parts.join(', ')
}

function ratioPhrase(a: number, b: number, other: string): string {
  const r = a / b
  if (Math.abs(r - 1) < 0.05) return `cost about the same as ${other}’s`
  if (r > 1) return `cost about ${r < 10 ? r.toFixed(1) : Math.round(r)}× as much as ${other}’s`
  return `cost about ${Math.max(1, Math.round(r * 100))}% of ${other}’s`
}

function timePhrase(a: number, b: number): string {
  const d = a - b
  if (Math.abs(d) < 100) return 'took about as long at the median'
  return `took ${formatDuration(Math.abs(d))} ${d > 0 ? 'longer' : 'less'} at the median`
}

/** "its answers cost about 3.1× as much as A’s and took 1.4 s longer at the median", or null. */
function compare(subject: SetupRow, other: SetupRow): string | null {
  const a = subject.metrics
  const b = other.metrics
  const clauses: string[] = []
  if (a.cost.perAnswerMedianMicroUsd && b.cost.perAnswerMedianMicroUsd) clauses.push(ratioPhrase(a.cost.perAnswerMedianMicroUsd, b.cost.perAnswerMedianMicroUsd, other.label))
  if (a.latency.medianMs !== null && b.latency.medianMs !== null) clauses.push(timePhrase(a.latency.medianMs, b.latency.medianMs))
  return clauses.length ? clauses.join(' and ') : null
}

/**
 * One sentence tying cost and speed to the headline. With a leader, it compares the leader
 * with the runner-up; when the count is close or tied, it states cost and speed only.
 */
export function setupSentence(tally: Pick<Tally, 'outcome' | 'leader' | 'parties' | 'questions'>, rows: readonly SetupRow[]): string {
  const generated = rows.filter((row) => row.metrics.source === 'generated')
  if (generated.length === 0) return 'Every party was imported, so there is no cost or timing to compare.'
  if (tally.outcome === 'lead' && tally.leader) {
    const leader = rows.find((row) => row.key === tally.leader)
    const party = tally.parties.find((p) => p.key === tally.leader)
    const runnerUp = [...tally.parties].filter((p) => p.key !== tally.leader).sort((x, y) => y.wins - x.wins || y.total - x.total)[0]
    const other = rows.find((row) => row.key === runnerUp?.key)
    if (leader && party && other && leader.metrics.source === 'generated' && other.metrics.source === 'generated') {
      const clause = compare(leader, other)
      if (clause) return `${leader.label} scored higher on ${party.wins} of ${tally.questions.length} questions; its answers ${clause}.`
    }
  }
  if (generated.length === 2) {
    const clause = compare(generated[0], generated[1])
    if (clause) return `${generated[0].label}’s answers ${clause}.`
  }
  const priced = generated.filter((row) => row.metrics.cost.perAnswerMedianMicroUsd !== null)
  const timed = generated.filter((row) => row.metrics.latency.medianMs !== null)
  const parts: string[] = []
  if (priced.length >= 2) {
    const cheapest = [...priced].sort((x, y) => x.metrics.cost.perAnswerMedianMicroUsd! - y.metrics.cost.perAnswerMedianMicroUsd!)[0]
    parts.push(`Lowest estimated cost per answer: ${cheapest.label} (${formatMicroUsd(cheapest.metrics.cost.perAnswerMedianMicroUsd!)}).`)
  }
  if (timed.length >= 2) {
    const fastest = [...timed].sort((x, y) => x.metrics.latency.medianMs! - y.metrics.latency.medianMs!)[0]
    parts.push(`Fastest at the median: ${fastest.label} (${formatDuration(fastest.metrics.latency.medianMs)}).`)
  }
  return parts.length ? parts.join(' ') : 'Not enough recorded usage to compare cost or speed.'
}

export function priceSources(sources: Record<ProviderId, string>): Array<{ name: string; url: string }> {
  return (Object.keys(sources) as ProviderId[]).map((provider) => ({ name: PROVIDER_NAMES[provider], url: sources[provider] }))
}
