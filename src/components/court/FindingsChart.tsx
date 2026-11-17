/**
 * Compact findings chart: one bar per party for each rubric line, on the
 * 0–2 scale. The table beside it carries the same numbers, so the chart is
 * hidden from assistive tech and every bar is labelled in text.
 */

import { DIMENSIONS, formatScore, rubricLines, type CohortResult } from '@/domain/rubric'
import { cn } from '@/lib/utils'

const BAR_TONES = ['bg-foreground', 'bg-primary/70', 'bg-manila-foreground/70'] as const

export function FindingsChart({ cohort, parties, rubricVersion }: { cohort: CohortResult; parties: Array<{ key: string; label: string }>; rubricVersion?: string }) {
  const RUBRIC = rubricLines(rubricVersion)
  const by = cohort.byConfiguration
  if (!by) return null
  const rows = [...DIMENSIONS.map((d) => ({ key: d, label: RUBRIC[d].label, value: (k: string) => by[k].dimensions[d].mean })), { key: 'overall', label: 'Overall mean', value: (k: string) => by[k].overallMean }]
  return (
    <figure className="mb-4 exhibit-panel px-5 py-4">
      <div aria-hidden className="space-y-4">
        {rows.map((row) => (
          <div key={row.key}>
            <div className={cn('mb-1.5 font-heading text-sm', row.key === 'overall' && 'font-bold')}>{row.label}</div>
            <div className="space-y-1.5 sm:space-y-1">
              {parties.map((party, index) => {
                const mean = row.value(party.key)
                return (
                  <div key={party.key} className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-x-2 gap-y-0.5 text-xs sm:grid-cols-[minmax(0,12rem)_1fr_2.5rem]">
                    <span className="col-span-2 truncate text-muted-foreground sm:col-span-1" title={party.label}>
                      {party.label}
                    </span>
                    <span className="relative h-2.5 rounded-full bg-paper-rule">
                      <span className={cn('absolute inset-y-0 left-0 rounded-full', BAR_TONES[index % BAR_TONES.length])} style={{ width: `${Math.max(0, Math.min(1, mean / 2)) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{formatScore(mean)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">Means on the 0–2 scale. The table below has the same numbers.</figcaption>
    </figure>
  )
}
