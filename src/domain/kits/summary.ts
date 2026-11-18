/**
 * Per-party check counts for one hearing (spec 03 §3.7, D-76). Pure and browser-safe, so a
 * comparison page (roadmap item 2) can lay several hearings side by side from their results.
 * Counts cover eligible questions only, like the jury's findings, and never feed them.
 */

import type { CaseInput } from '../contracts'
import { checkCaseOf } from './runner'
import type { CheckResult, CheckRow, CheckStatus, KitMetric, TaskKit } from './types'

export type CheckCounts = Record<CheckStatus, number>

export interface Fraction {
  numerator: number
  denominator: number
}

export interface ChecksSummary {
  /** The kit version whose checks produced these results. */
  kitVersion: string
  definitions: Array<{ id: string; label: string; description: string }>
  /** Eligible questions only; counts per party per check id. */
  byConfiguration: Record<string, Record<string, CheckCounts>>
  metrics: KitMetric[]
  /** Eligible questions where no check failed or errored, per party. */
  allPassed: Record<string, Fraction>
  /**
   * Spec 01 §10, only with repeats: succeeded samples on eligible questions where no check failed
   * or errored, per generated party. Null without repeats.
   */
  allPassedSamples: Record<string, Fraction> | null
}

export interface SummarizeChecksInput {
  kit: TaskKit<unknown, unknown>
  settings: unknown
  cases: ReadonlyArray<CaseInput>
  eligibleCaseKeys: readonly string[]
  configurationKeys: readonly string[]
  /** One row per scored (primary) testimony; rows on excluded questions are ignored. */
  rows: ReadonlyArray<CheckRow>
  /** With repeats: one row per succeeded sample of each generated party. */
  sampleRows?: ReadonlyArray<CheckRow>
}

export function emptyCounts(): CheckCounts {
  return { pass: 0, fail: 0, na: 0, error: 0 }
}

/** No check failed and none errored; a testimony with no results at all counts as passed. */
export function passedEvery(results: readonly CheckResult[]): boolean {
  return results.every((result) => result.status === 'pass' || result.status === 'na')
}

function passRate(rows: ReadonlyArray<CheckRow>, configurationKeys: readonly string[]): Record<string, Fraction> {
  return Object.fromEntries(
    configurationKeys.map((key) => {
      const own = rows.filter((row) => row.configurationKey === key)
      return [key, { numerator: own.filter((row) => passedEvery(row.results)).length, denominator: own.length }]
    }),
  )
}

export function summarizeChecks(input: SummarizeChecksInput): ChecksSummary {
  const eligible = new Set(input.eligibleCaseKeys)
  const rows = input.rows.filter((row) => eligible.has(row.caseKey))
  const definitions = input.kit.checks.map((check) => ({ id: check.id, label: check.label, description: check.description }))
  const byConfiguration: ChecksSummary['byConfiguration'] = {}
  for (const key of input.configurationKeys) {
    const counts: Record<string, CheckCounts> = Object.fromEntries(definitions.map((definition) => [definition.id, emptyCounts()]))
    for (const row of rows.filter((candidate) => candidate.configurationKey === key)) {
      for (const result of row.results) (counts[result.checkId] ??= emptyCounts())[result.status]++
    }
    byConfiguration[key] = counts
  }
  const metrics =
    input.kit.metrics?.({
      settings: input.settings,
      cases: input.cases.filter((testCase) => eligible.has(testCase.key)).map(checkCaseOf),
      rows,
      configurationKeys: input.configurationKeys,
    }) ?? []
  return {
    kitVersion: input.kit.version,
    definitions,
    byConfiguration,
    metrics,
    allPassed: passRate(rows, input.configurationKeys),
    allPassedSamples: input.sampleRows
      ? passRate(
          input.sampleRows.filter((row) => eligible.has(row.caseKey)),
          input.configurationKeys.filter((key) => input.sampleRows!.some((row) => row.configurationKey === key)),
        )
      : null,
  }
}
