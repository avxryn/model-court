/**
 * The fixed reference-QA rubric and deterministic scoring (spec §2.4, §2.6).
 * Pure functions: no I/O, no clocks. The UI labels and the server scorer both
 * import this module, so a rubric change has one definition (E02).
 */

import type { DraftRating, Score } from './contracts'
import { LIMITS } from './limits'
import { codePointLength } from './text'

export const RUBRIC_VERSION = 'reference-qa-v1' as const

export const DIMENSIONS = ['correctness', 'completeness', 'grounding'] as const
export type Dimension = (typeof DIMENSIONS)[number]

export const RUBRIC: Record<Dimension, { label: string; anchors: Record<Score, string> }> = {
  correctness: {
    label: 'Correctness',
    anchors: {
      0: 'Materially contradicts supplied evidence or expected behavior',
      1: 'Partially correct, with a substantive error or ambiguity',
      2: 'Consistent with the reference and expected behavior',
    },
  },
  completeness: {
    label: 'Completeness',
    anchors: {
      0: 'Misses the core request',
      1: 'Addresses the core request but omits a required part',
      2: 'Addresses all required parts, including appropriate clarification or abstention',
    },
  },
  grounding: {
    label: 'Grounding',
    anchors: {
      0: 'Contains a material unsupported assertion',
      1: 'Contains a minor unsupported assertion or unclear attribution',
      2: 'No unsupported factual claim relative to the supplied evidence',
    },
  },
}

export interface CompleteRating {
  responseId: string
  correctness: Score
  completeness: Score
  grounding: Score
  note: string
  suspectedIdentityClue: boolean
}

export function noteRequired(rating: Pick<DraftRating, Dimension>): boolean {
  return DIMENSIONS.some((dimension) => rating[dimension] === 0)
}

export type RatingIssue =
  | { kind: 'unknown_response'; responseId: string }
  | { kind: 'duplicate_response'; responseId: string }
  | { kind: 'missing_response'; responseId: string }
  | { kind: 'missing_score'; responseId: string; dimension: Dimension }
  | { kind: 'note_required'; responseId: string }

/** Drafts may be partial but must only reference the session's own responses. */
export function draftRatingIssues(assignedResponseIds: readonly string[], ratings: readonly DraftRating[]): RatingIssue[] {
  const assigned = new Set(assignedResponseIds)
  const seen = new Set<string>()
  const issues: RatingIssue[] = []
  for (const rating of ratings) {
    if (!assigned.has(rating.responseId)) issues.push({ kind: 'unknown_response', responseId: rating.responseId })
    else if (seen.has(rating.responseId)) issues.push({ kind: 'duplicate_response', responseId: rating.responseId })
    seen.add(rating.responseId)
  }
  return issues
}

/** Submission requires every assigned response fully scored, with notes for zeros. */
export function submissionIssues(assignedResponseIds: readonly string[], ratings: readonly DraftRating[]): RatingIssue[] {
  const issues = draftRatingIssues(assignedResponseIds, ratings)
  const byId = new Map(ratings.map((rating) => [rating.responseId, rating]))
  for (const responseId of assignedResponseIds) {
    const rating = byId.get(responseId)
    if (!rating) {
      issues.push({ kind: 'missing_response', responseId })
      continue
    }
    for (const dimension of DIMENSIONS) {
      if (rating[dimension] === null) issues.push({ kind: 'missing_score', responseId, dimension })
    }
    if (noteRequired(rating) && codePointLength(rating.note.trim()) < LIMITS.ratingNote.min) {
      issues.push({ kind: 'note_required', responseId })
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoredSession {
  sessionId: string
  contextType: 'invited' | 'owner'
  identityClueFlag: boolean
  /** One entry per eligible case: which configuration produced each response. */
  responses: Array<{ caseKey: string; responseId: string; configurationKey: string }>
  ratings: CompleteRating[]
}

export interface DimensionAggregate {
  sum: number
  count: number
  /** sum / count, unrounded; display rounds to two decimals. */
  mean: number
}

export interface ConfigurationAggregate {
  dimensions: Record<Dimension, DimensionAggregate>
  overallSum: number
  /** Mean of the three dimension means. */
  overallMean: number
}

export interface CohortResult {
  contextType: 'invited' | 'owner'
  reviewerCount: number
  caseCount: number
  /** null when the cohort has no submitted sessions ("No reviews", never zero). */
  byConfiguration: Record<string, ConfigurationAggregate> | null
  /** Configurations sharing the exact highest unrounded total. Empty without reviews. */
  highest: string[]
  potentiallyUnblindedCount: number
}

export interface Disagreement {
  caseKey: string
  configurationKey: string
  dimension: Dimension
  min: Score
  max: Score
}

function emptyAggregate(): ConfigurationAggregate {
  const dimension = (): DimensionAggregate => ({ sum: 0, count: 0, mean: 0 })
  return {
    dimensions: { correctness: dimension(), completeness: dimension(), grounding: dimension() },
    overallSum: 0,
    overallMean: 0,
  }
}

/**
 * dimensionMean(k,d) = Σ s(c,k,r,d) / (|E| × |R|); overallMean(k) = Σ_d dimensionMean / 3.
 * Every submitted session covers the same eligible cases, so each reviewer counts equally.
 */
export function scoreCohort(
  contextType: 'invited' | 'owner',
  eligibleCaseKeys: readonly string[],
  configurationKeys: readonly string[],
  sessions: readonly ScoredSession[],
): CohortResult {
  const cohort = sessions.filter((session) => session.contextType === contextType)
  const eligible = new Set(eligibleCaseKeys)
  const base = {
    contextType,
    reviewerCount: cohort.length,
    caseCount: eligibleCaseKeys.length,
    potentiallyUnblindedCount: cohort.filter((session) => session.identityClueFlag).length,
  }
  if (cohort.length === 0 || eligibleCaseKeys.length === 0) {
    return { ...base, byConfiguration: null, highest: [] }
  }

  const aggregates: Record<string, ConfigurationAggregate> = {}
  for (const key of configurationKeys) aggregates[key] = emptyAggregate()

  for (const session of cohort) {
    const ratingById = new Map(session.ratings.map((rating) => [rating.responseId, rating]))
    for (const response of session.responses) {
      if (!eligible.has(response.caseKey)) continue
      const rating = ratingById.get(response.responseId)
      const aggregate = aggregates[response.configurationKey]
      if (!rating || !aggregate) throw new Error('Scored session is missing a rating or configuration')
      for (const dimension of DIMENSIONS) {
        aggregate.dimensions[dimension].sum += rating[dimension]
        aggregate.dimensions[dimension].count += 1
      }
    }
  }

  const denominator = eligibleCaseKeys.length * cohort.length
  for (const aggregate of Object.values(aggregates)) {
    for (const dimension of DIMENSIONS) {
      const entry = aggregate.dimensions[dimension]
      if (entry.count !== denominator) throw new Error('Cohort denominator mismatch')
      entry.mean = entry.sum / denominator
    }
    aggregate.overallSum = DIMENSIONS.reduce((total, dimension) => total + aggregate.dimensions[dimension].sum, 0)
    aggregate.overallMean = aggregate.overallSum / (denominator * DIMENSIONS.length)
  }

  // Exact ties compare integer totals; all candidates share one denominator.
  const best = Math.max(...configurationKeys.map((key) => aggregates[key].overallSum))
  const highest = configurationKeys.filter((key) => aggregates[key].overallSum === best)
  return { ...base, byConfiguration: aggregates, highest }
}

/** A disagreement is max − min ≥ 1 across at least two invited reviewers. */
export function findDisagreements(sessions: readonly ScoredSession[]): Disagreement[] {
  const invited = sessions.filter((session) => session.contextType === 'invited')
  if (invited.length < 2) return []
  const cells = new Map<string, { caseKey: string; configurationKey: string; dimension: Dimension; scores: Score[] }>()
  for (const session of invited) {
    const ratingById = new Map(session.ratings.map((rating) => [rating.responseId, rating]))
    for (const response of session.responses) {
      const rating = ratingById.get(response.responseId)
      if (!rating) continue
      for (const dimension of DIMENSIONS) {
        const id = `${response.caseKey}|${response.configurationKey}|${dimension}`
        const cell = cells.get(id) ?? { caseKey: response.caseKey, configurationKey: response.configurationKey, dimension, scores: [] }
        cell.scores.push(rating[dimension])
        cells.set(id, cell)
      }
    }
  }
  const disagreements: Disagreement[] = []
  for (const cell of cells.values()) {
    if (cell.scores.length < 2) continue
    const min = Math.min(...cell.scores) as Score
    const max = Math.max(...cell.scores) as Score
    if (max - min >= 1) disagreements.push({ caseKey: cell.caseKey, configurationKey: cell.configurationKey, dimension: cell.dimension, min, max })
  }
  return disagreements
}

export function formatScore(value: number): string {
  return value.toFixed(2)
}
