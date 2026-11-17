/**
 * Findings by rubric line and party, with the overall mean last. One table
 * for the record, the sample and the printed judgment (`print` drops the
 * exhibit panel and marks for ink).
 */

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DIMENSIONS, formatScore, rubricLines, type CohortResult } from '@/domain/rubric'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'

export function FindingsTable({ cohort, parties, rubricVersion, caption, print = false, markHighest = !print }: { cohort: CohortResult; parties: ReadonlyArray<{ key: string; label: string }>; rubricVersion?: string; caption?: string; print?: boolean; markHighest?: boolean }) {
  const lines = rubricLines(rubricVersion)
  const by = cohort.byConfiguration
  if (!by) return null
  const tie = cohort.highest.length > 1
  return (
    <div className={cn(!print && 'exhibit-panel overflow-hidden')}>
      <Table className={cn(print && '[&_td]:px-0 [&_td]:py-1.5 [&_th]:h-auto [&_th]:px-0 [&_th]:py-1.5 [&_thead_tr]:border-foreground')}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <TableHeader>
          <TableRow>
            <TableHead>
              {plural(cohort.reviewerCount, 'rater')} × {plural(cohort.caseCount, 'question')}
            </TableHead>
            {parties.map((c) => (
              <TableHead key={c.key} className="text-right">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {DIMENSIONS.map((d) => (
            <TableRow key={d}>
              <TableCell>{lines[d].label}</TableCell>
              {parties.map((c) => (
                <TableCell key={c.key} className="text-right tabular-nums">
                  {formatScore(by[c.key].dimensions[d].mean)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow className={cn('font-semibold', print ? 'font-bold hover:bg-transparent' : 'bg-slip hover:bg-slip')}>
            <TableCell>Overall mean</TableCell>
            {parties.map((c) => {
              const highest = markHighest && cohort.highest.includes(c.key)
              return (
                <TableCell key={c.key} className={cn('text-right tabular-nums', highest && !tie && 'text-primary')}>
                  {formatScore(by[c.key].overallMean)}
                  {highest && <span className="ml-1 text-xs font-normal text-muted-foreground">{tie ? '(exact tie)' : '(highest)'}</span>}
                </TableCell>
              )
            })}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
