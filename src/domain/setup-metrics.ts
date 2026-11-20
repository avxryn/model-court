/**
 * Per-party cost, speed and reliability for one hearing (spec 01 §5.3). Pure and
 * browser-safe: the record computes it on read from recorded attempts and a
 * dated price table, and later comparison pages can price several hearings with
 * one table. Amounts are integer micro-dollars (µUSD). An estimate, never a charge.
 */

import { consistencyMetrics, type ConsistencyMetrics } from './consistency'
import type { ProviderId } from './registry'
import { callCostMicroUsd, priceFor, type PriceTable } from './prices'
import type { GenerationStatus } from './transitions'

export type AttemptStatus = 'running' | 'succeeded' | 'failed' | 'uncertain' | 'canceled'

export interface AttemptUsage {
  attemptNo: number
  status: AttemptStatus
  errorCode: string | null
  /** true = definite failure, false = may have reached the provider (uncertain), null = not finished or succeeded. */
  definite: boolean | null
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  durationMs: number | null
  /**
   * D-113: provider calls this attempt sent, when recorded: 0 for an attempt refused before any send,
   * the steps a tool loop sent. Absent or null: the record's per-attempt count, as before.
   */
  providerCalls?: number | null
}

/** One testimony (one generation slot), however many provider calls it took. */
export interface UsageRecord {
  caseKey: string
  configurationKey: string
  sampleNo: number
  status: GenerationStatus
  attempts: AttemptUsage[]
  /** Provider calls inside one attempt: 1 today, more for later tool-loop kits. */
  calls?: number
  /** The accepted answer, for consistency across samples (D-66). */
  text?: string | null
}

export interface SetupParty {
  key: string
  source: 'generated' | 'imported'
  provider: ProviderId | null
  /** The registry route key (`MODEL_ROUTES[].key`) the party was frozen with. */
  routeKey: string | null
}

export interface SetupMetricsInput {
  parties: readonly SetupParty[]
  eligibleCaseKeys: readonly string[]
  records: readonly UsageRecord[]
  /** D-65: with more than one, each generated party also gets `consistency`. */
  samplesPerAnswer?: number
}

export type CostStatus = 'estimated' | 'partial' | 'no_price' | 'imported'

export interface PartyMetrics {
  source: 'generated' | 'imported'
  calls: {
    planned: number
    succeeded: number
    failed: number
    uncertain: number
    canceled: number
    /** Manual retries (attempt 2). */
    retries: number
    /** Error codes of failed and uncertain attempts. */
    errorCodes: Record<string, number>
    /** Provider calls made, counting calls inside an attempt (equals attempts made today). */
    providerCalls: number
    /** Median provider calls per succeeded answer; 1 unless a kit loops. */
    medianPerAnswer: number | null
  }
  latency: { medianMs: number | null; slowestMs: number | null; n: number }
  tokens: {
    medianInput: number | null
    medianOutput: number | null
    totalInput: number
    totalOutput: number
    /** null = no call recorded it (older hearings, or the provider did not report it). */
    totalCachedInput: number | null
    totalReasoning: number | null
    /** Succeeded attempts that came back without usage. */
    unknownUsage: number
  }
  cost: {
    status: CostStatus
    perAnswerMedianMicroUsd: number | null
    perThousandMicroUsd: number | null
    hearingMicroUsd: number | null
    /** Calls that may have been billed but whose usage is unknown (uncertain, or succeeded without usage). */
    possiblyBilledUnknown: number
    /** Priced calls whose cached input was unknown, so cached tokens (if any) were priced at the full input rate. */
    cachedAssumedFull: number
  }
  /** Only with repeats (D-66); null otherwise and for imported parties. */
  consistency: ConsistencyMetrics | null
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null)
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null
}

const IMPORTED_METRICS = (planned: number, succeeded: number): PartyMetrics => ({
  source: 'imported',
  calls: { planned, succeeded, failed: 0, uncertain: 0, canceled: 0, retries: 0, errorCodes: {}, providerCalls: 0, medianPerAnswer: null },
  latency: { medianMs: null, slowestMs: null, n: 0 },
  tokens: { medianInput: null, medianOutput: null, totalInput: 0, totalOutput: 0, totalCachedInput: null, totalReasoning: null, unknownUsage: 0 },
  cost: { status: 'imported', perAnswerMedianMicroUsd: null, perThousandMicroUsd: null, hearingMicroUsd: null, possiblyBilledUnknown: 0, cachedAssumedFull: 0 },
  consistency: null,
})

/**
 * Totals (this hearing, failures, retries) count every call that was made.
 * Per-answer medians and latency use succeeded answers on eligible questions only,
 * so every party is measured on the same questions. "Slowest" is the maximum.
 */
export function setupMetrics(input: SetupMetricsInput, table: PriceTable, importedCounts: Readonly<Record<string, { planned: number; present: number }>> = {}): Record<string, PartyMetrics> {
  const eligible = new Set(input.eligibleCaseKeys)
  const result: Record<string, PartyMetrics> = {}
  for (const party of input.parties) {
    if (party.source === 'imported') {
      const counts = importedCounts[party.key] ?? { planned: 0, present: 0 }
      result[party.key] = IMPORTED_METRICS(counts.planned, counts.present)
      continue
    }
    const records = input.records.filter((record) => record.configurationKey === party.key)
    const price = party.provider && party.routeKey ? priceFor(party.routeKey, table) : null
    const provider = party.provider

    const errorCodes: Record<string, number> = {}
    let retries = 0
    let providerCalls = 0
    let totalInput = 0
    let totalOutput = 0
    let unknownUsage = 0
    let possiblyBilledUnknown = 0
    let cachedAssumedFull = 0
    let hearingMicroUsd = 0
    const cached: Array<number | null> = []
    const reasoning: Array<number | null> = []
    // Per succeeded answer on an eligible question.
    const answerCosts: number[] = []
    let answerCostUnknown = false
    const answerInput: number[] = []
    const answerOutput: number[] = []
    const answerCalls: number[] = []
    const durations: number[] = []

    for (const record of records) {
      const callsPerAttempt = Math.max(1, record.calls ?? 1)
      for (const attempt of record.attempts) {
        if (attempt.attemptNo === 2) retries++
        if (attempt.status === 'running') continue
        // A canceled attempt never reached the provider; one refused before the send (D-113) sent nothing
        // either, but its error still counts, because the owner should see why the testimony is missing.
        const canceled = attempt.status === 'canceled' || attempt.errorCode === 'CANCELED'
        if (!canceled) providerCalls += typeof attempt.providerCalls === 'number' ? attempt.providerCalls : callsPerAttempt
        if ((attempt.status === 'failed' || attempt.status === 'uncertain') && attempt.errorCode && !canceled) {
          errorCodes[attempt.errorCode] = (errorCodes[attempt.errorCode] ?? 0) + 1
        }
        const hasUsage = attempt.inputTokens !== null && attempt.outputTokens !== null
        if (hasUsage) {
          totalInput += attempt.inputTokens!
          totalOutput += attempt.outputTokens!
          cached.push(attempt.cachedInputTokens)
          reasoning.push(attempt.reasoningTokens)
          if (price && provider) {
            const cost = callCostMicroUsd(provider, attempt, price, table)
            if (cost) {
              hearingMicroUsd += cost.microUsd
              if (cost.cachedAssumedFull) cachedAssumedFull++
            }
          }
        } else if (attempt.status === 'succeeded') {
          unknownUsage++
          possiblyBilledUnknown++
        } else if (attempt.status === 'uncertain' || (attempt.status === 'failed' && attempt.definite === false)) {
          possiblyBilledUnknown++
        }
        // A definite failure without usage adds nothing: not charged as far as we know.

        if (attempt.status === 'succeeded' && record.status === 'succeeded' && eligible.has(record.caseKey)) {
          if (attempt.durationMs !== null) durations.push(attempt.durationMs)
          answerCalls.push(callsPerAttempt)
          if (hasUsage) {
            answerInput.push(attempt.inputTokens!)
            answerOutput.push(attempt.outputTokens!)
            const cost = price && provider ? callCostMicroUsd(provider, attempt, price, table) : null
            if (cost) answerCosts.push(cost.microUsd)
          } else {
            answerCostUnknown = true
          }
        }
      }
    }

    const status: CostStatus = !price ? 'no_price' : possiblyBilledUnknown > 0 || answerCostUnknown ? 'partial' : 'estimated'
    const mean = answerCosts.length ? answerCosts.reduce((sum, value) => sum + value, 0) / answerCosts.length : null
    result[party.key] = {
      source: 'generated',
      calls: {
        planned: records.length,
        succeeded: records.filter((record) => record.status === 'succeeded').length,
        failed: records.filter((record) => record.status === 'failed').length,
        uncertain: records.filter((record) => record.status === 'uncertain').length,
        canceled: records.filter((record) => record.status === 'canceled').length,
        retries,
        errorCodes,
        providerCalls,
        medianPerAnswer: median(answerCalls),
      },
      latency: { medianMs: median(durations), slowestMs: durations.length ? Math.max(...durations) : null, n: durations.length },
      tokens: {
        medianInput: median(answerInput),
        medianOutput: median(answerOutput),
        totalInput,
        totalOutput,
        totalCachedInput: sumOrNull(cached),
        totalReasoning: sumOrNull(reasoning),
        unknownUsage,
      },
      cost: {
        status,
        perAnswerMedianMicroUsd: price ? median(answerCosts) : null,
        perThousandMicroUsd: price && mean !== null ? Math.round(mean * 1000) : null,
        hearingMicroUsd: price ? hearingMicroUsd : null,
        possiblyBilledUnknown,
        cachedAssumedFull,
      },
      consistency: (input.samplesPerAnswer ?? 1) > 1 ? partyConsistency(records, input.samplesPerAnswer!) : null,
    }
  }
  return result
}

/** Every question's samples for one party, in question order of first appearance, lowest sample first. */
function partyConsistency(records: readonly UsageRecord[], planned: number): ConsistencyMetrics {
  const byCase = new Map<string, UsageRecord[]>()
  for (const record of records) byCase.set(record.caseKey, [...(byCase.get(record.caseKey) ?? []), record])
  return consistencyMetrics(
    [...byCase.entries()].map(([caseKey, samples]) => ({
      caseKey,
      planned,
      samples: [...samples]
        .sort((a, b) => a.sampleNo - b.sampleNo)
        .map((record) => {
          const accepted = record.status === 'succeeded' ? record.attempts.find((attempt) => attempt.status === 'succeeded') : undefined
          return { status: record.status, text: record.text ?? null, outputTokens: accepted?.outputTokens ?? null, durationMs: accepted?.durationMs ?? null }
        }),
    })),
  )
}

/**
 * Plain-dollar text for an estimate in µUSD: two significant figures below $1
 * ("$0.0031"), cents above, and "under $0.0001" for tiny amounts. Never "$0" for a cost
 * that is unknown; callers handle null themselves.
 */
export function formatMicroUsd(microUsd: number): string {
  if (microUsd === 0) return '$0'
  if (microUsd < 100) return 'under $0.0001'
  const usd = microUsd / 1_000_000
  if (usd < 1) return `$${Number(usd.toPrecision(2)).toString()}`
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
