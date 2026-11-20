/**
 * Findings by rubric line and party, with the overall mean last. One table
 * for the record, the sample and the printed judgment (`print` drops the
 * exhibit panel and marks for ink). On a phone, a card per party (D-120), so the
 * party names keep their width; print always gets the table.
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
  // Spec 07 §9.4: with four or five parties the table scrolls sideways at narrow widths; the line names stay in view.
  const wide = !print && parties.length >= 4
  const hintId = `findings-hint-${cohort.contextType}`
  const raters = `${plural(cohort.reviewerCount, 'rater')} × ${plural(cohort.caseCount, 'question')}`
  return (
    <>
    <div className={cn(!print && 'hidden exhibit-panel overflow-hidden sm:block')}>
      <Table aria-describedby={wide ? hintId : undefined} className={cn(print && '[&_td]:px-0 [&_td]:py-1.5 [&_th]:h-auto [&_th]:px-0 [&_th]:py-1.5 [&_thead_tr]:border-foreground', wide && '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-10 [&_tr>*:first-child]:bg-card')}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <TableHeader>
          <TableRow>
            <TableHead>
              {raters}
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
                  {highest && <span className="ml-1 text-caption font-normal text-muted-foreground">{tie ? '(exact tie)' : '(highest)'}</span>}
                </TableCell>
              )
            })}
          </TableRow>
        </TableBody>
      </Table>
      {wide && (
        <p id={hintId} className="border-t border-border px-3 py-2 text-caption text-muted-foreground md:hidden">
          Scroll sideways for more parties.
        </p>
      )}
    </div>
    {!print && (
      <div className="space-y-2 sm:hidden">
        <p className="text-caption text-muted-foreground">{raters}</p>
        <ul className="space-y-2" aria-label={caption ?? 'Findings by party'}>
          {parties.map((c) => {
            const highest = markHighest && cohort.highest.includes(c.key)
            return (
              <li key={c.key} className="exhibit-panel px-4 py-3">
                <p className="text-small font-medium">{c.label}</p>
                <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-small">
                  {DIMENSIONS.map((d) => (
                    <div key={d} className="contents">
                      <dt className="text-muted-foreground">{lines[d].label}</dt>
                      <dd className="text-right tabular-nums">{formatScore(by[c.key].dimensions[d].mean)}</dd>
                    </div>
                  ))}
                  <dt className="font-semibold">Overall mean</dt>
                  <dd className={cn('text-right font-semibold tabular-nums', highest && !tie && 'text-primary')}>
                    {formatScore(by[c.key].overallMean)}
                    {highest && <span className="ml-1 text-caption font-normal text-muted-foreground">{tie ? '(exact tie)' : '(highest)'}</span>}
                  </dd>
                </dl>
              </li>
            )
          })}
        </ul>
      </div>
    )}
    </>
  )
}
