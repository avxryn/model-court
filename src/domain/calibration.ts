/**
 * Special-master calibration (D-40): how closely the AI grader agrees with
 * the jury, shown before its own totals. Pure. Only the invited cohort is
 * compared; the judge's context-aware review is never part of this.
 */

import { DIMENSIONS, type Dimension } from './rubric'

type Scores = Record<Dimension, number>

export interface CalibrationItem {
  caseKey: string
  configurationKey: string
  grader: Scores & { note: string }
  /** One entry per juror who rated this response. */
  jurors: Scores[]
}

export interface DimensionAgreement {
  items: number
  /** Share of items where the grader score lies within the jurors' min–max. */
  withinJuryRange: number
  /** Share of items where the grader score equals the jury median (rounded down on ties). */
  exactWithMedian: number
  /** Mean of |grader − jury mean|. */
  meanAbsoluteDifference: number
}

export interface Calibration {
  items: number
  jurors: number
  byDimension: Record<Dimension | 'overall', DimensionAgreement>
  /** Does the grader rank the same party highest as the jury (by overall mean)? null when either is tied or empty. */
  sameTopParty: boolean | null
  graderTop: string[]
  juryTop: string[]
  disagreements: Array<{ caseKey: string; configurationKey: string; dimension: Dimension; grader: number; juryMin: number; juryMax: number; note: string }>
  /** Plain-words caveat about sample size; always shown. */
  caveat: string
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

function agreement(pairs: Array<{ grader: number; jurors: number[] }>): DimensionAgreement {
  if (pairs.length === 0) return { items: 0, withinJuryRange: 0, exactWithMedian: 0, meanAbsoluteDifference: 0 }
  return {
    items: pairs.length,
    withinJuryRange: mean(pairs.map((p) => (p.grader >= Math.min(...p.jurors) && p.grader <= Math.max(...p.jurors) ? 1 : 0))),
    exactWithMedian: mean(pairs.map((p) => (p.grader === median(p.jurors) ? 1 : 0))),
    meanAbsoluteDifference: mean(pairs.map((p) => Math.abs(p.grader - mean(p.jurors)))),
  }
}

function topParties(totals: Map<string, number[]>): string[] {
  const means = [...totals.entries()].map(([key, values]) => [key, mean(values)] as const)
  if (means.length === 0) return []
  const best = Math.max(...means.map(([, value]) => value))
  return means.filter(([, value]) => value === best).map(([key]) => key)
}

export function calibrate(rawItems: readonly CalibrationItem[], jurorCount: number): Calibration {
  const items = rawItems.filter((item) => item.jurors.length > 0)
  const byDimension = Object.fromEntries(DIMENSIONS.map((d) => [d, agreement(items.map((item) => ({ grader: item.grader[d], jurors: item.jurors.map((j) => j[d]) })))])) as Record<Dimension, DimensionAgreement>
  const overallPairs = items.map((item) => ({
    grader: mean(DIMENSIONS.map((d) => item.grader[d])),
    jurors: item.jurors.map((j) => mean(DIMENSIONS.map((d) => j[d]))),
  }))
  const overall = agreement(overallPairs)
  // Overall agreement on continuous means: "exact" is not meaningful, so it reports within-range and distance only.
  overall.exactWithMedian = Number.NaN

  const graderTotals = new Map<string, number[]>()
  const juryTotals = new Map<string, number[]>()
  for (const item of items) {
    graderTotals.set(item.configurationKey, [...(graderTotals.get(item.configurationKey) ?? []), mean(DIMENSIONS.map((d) => item.grader[d]))])
    juryTotals.set(item.configurationKey, [...(juryTotals.get(item.configurationKey) ?? []), ...item.jurors.map((j) => mean(DIMENSIONS.map((d) => j[d])))])
  }
  const graderTop = topParties(graderTotals)
  const juryTop = topParties(juryTotals)
  const sameTopParty = graderTop.length === 1 && juryTop.length === 1 ? graderTop[0] === juryTop[0] : null

  const disagreements = items.flatMap((item) =>
    DIMENSIONS.flatMap((d) => {
      const scores = item.jurors.map((j) => j[d])
      const juryMin = Math.min(...scores)
      const juryMax = Math.max(...scores)
      return item.grader[d] < juryMin || item.grader[d] > juryMax ? [{ caseKey: item.caseKey, configurationKey: item.configurationKey, dimension: d, grader: item.grader[d], juryMin, juryMax, note: item.grader.note }] : []
    }),
  )

  const caveat =
    items.length < 30
      ? `${items.length} graded response${items.length === 1 ? '' : 's'} and ${jurorCount} juror${jurorCount === 1 ? '' : 's'}: too few to rely on the grader. Treat this as a first look.`
      : `${items.length} graded responses and ${jurorCount} juror${jurorCount === 1 ? '' : 's'}. Agreement here does not prove the grader will agree on other questions.`

  return { items: items.length, jurors: jurorCount, byDimension: { ...byDimension, overall }, sameTopParty, graderTop, juryTop, disagreements, caveat }
}
