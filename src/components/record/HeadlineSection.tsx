/**
 * The record's headline: one plain sentence from the scores, each
 * party's wins, ties, losses and points, the close questions, and a
 * head-to-head table. Jury scores when any juror scored; in a solo case the
 * judge's own review, said plainly. Never a mix of the two.
 */

import type { ReactNode } from 'react'
import { ArrowDown, Check } from 'lucide-react'
import { SheetSection } from '@/components/court/CaseFile'
import { Plain } from '@/components/court/Paper'
import { TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { findSplits } from '@/components/record/DisagreementSection'
import { formatPoints, recordTally, type Tally, type TallySource } from '@/components/record/headline'
import type { ResultsView } from '@/lib/dto'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PairwiseTable } from '@/components/record/PairwiseTable'

const linkClass = 'rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50'

/** The sentence, the per-party counts, and the questions decided by a point or less. */
export function HeadlineSummary({ tally, questionHref, children }: { tally: Tally; questionHref?: (key: string) => string; children?: ReactNode }) {
  const single = tally.raters <= 1
  const decided = tally.questions.length - tally.tied
  return (
    <div className="space-y-4">
      <p className="max-w-3xl font-display text-2xl leading-snug font-medium" data-outcome={tally.outcome}>
        {tally.sentence}
      </p>
      {tally.questions.length > 0 && (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            {tally.parties.map((p) => (
              <div key={p.key} className={cn('exhibit-panel px-4 py-3', tally.leader === p.key && 'ring-1 ring-primary/40')}>
                <dt className="text-sm font-semibold">{p.label}</dt>
                <dd className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground tabular-nums">
                  <span>
                    {p.wins} won · {p.ties} tied · {p.losses} lost
                  </span>
                  <span>
                    <span className="font-medium text-foreground">{formatPoints(p.total)}</span> of {tally.maxTotal} points
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li className="tabular-nums">
              {tally.totalLeader ? (
                <>
                  Margin: {formatPoints(tally.totalMargin)} {tally.totalMargin === 1 ? 'point' : 'points'} overall, of {tally.maxTotal} possible.
                </>
              ) : (
                <>The point totals are equal.</>
              )}
              {!single && ' Points are means across raters.'}
            </li>
            {decided > 0 && (
              <li>
                {tally.close.length === 0 ? (
                  `No decided question was won by ${single ? 'a single point' : 'a point or less'}.`
                ) : (
                  <>
                    {tally.close.length} of {plural(decided, 'decided question')} {tally.close.length === 1 ? 'was' : 'were'} won by {single ? 'a single point' : 'a point or less'}:{' '}
                    {tally.close.map((q, i) => (
                      <span key={q.key}>
                        {i > 0 && ', '}
                        {questionHref ? (
                          <a href={questionHref(q.key)} className={linkClass}>
                            Q{q.number}
                          </a>
                        ) : (
                          `Q${q.number}`
                        )}
                      </span>
                    ))}
                    .
                  </>
                )}
              </li>
            )}
          </ul>
        </>
      )}
      {children}
    </div>
  )
}

/** Per question, each party's points with a mark on the winner. Scrolls inside its own frame on a phone. */
export function HeadToHeadTable({ tally, questionHref }: { tally: Tally; questionHref?: (key: string) => string }) {
  if (tally.questions.length === 0) return null
  const parties = tally.parties
  return (
    <div className="exhibit-panel overflow-hidden">
      <div className="overflow-x-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/50" tabIndex={0} role="region" aria-label="Head to head, question by question">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">
            Head to head: each party’s points per question, out of {tally.maxPerQuestion}. A check marks the higher score.
          </caption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-28">Question</TableHead>
              {parties.map((p) => (
                <TableHead key={p.key} className="min-w-20 text-right whitespace-normal">
                  {p.label}
                </TableHead>
              ))}
              <TableHead className="text-right">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tally.questions.map((q) => (
              <TableRow key={q.key}>
                <TableCell className="whitespace-normal">
                  {questionHref ? (
                    <a href={questionHref(q.key)} className={cn(linkClass, 'font-medium text-foreground')}>
                      Q{q.number}
                    </a>
                  ) : (
                    <span className="font-medium">Q{q.number}</span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">{q.title}</span>
                </TableCell>
                {parties.map((p) => {
                  const won = q.winner === p.key
                  return (
                    <TableCell key={p.key} className={cn('text-right tabular-nums', won ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                      <span className="inline-flex items-center justify-end gap-1">
                        {won && <Check aria-hidden className="size-3.5 text-primary" />}
                        {formatPoints(q.scores[p.key])}
                        {won && <span className="sr-only"> (higher)</span>}
                      </span>
                    </TableCell>
                  )
                })}
                <TableCell className="text-right text-muted-foreground tabular-nums">{q.winner ? formatPoints(q.margin) : 'Tie'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-slip">
            <TableRow className="hover:bg-slip">
              <TableCell className="font-semibold">Total</TableCell>
              {parties.map((p) => (
                <TableCell key={p.key} className={cn('text-right font-semibold tabular-nums', tally.totalLeader === p.key && 'text-primary')}>
                  {formatPoints(p.total)}
                </TableCell>
              ))}
              <TableCell className="text-right font-semibold tabular-nums">{tally.totalLeader ? formatPoints(tally.totalMargin) : 'Tie'}</TableCell>
            </TableRow>
          </TableFooter>
        </table>
      </div>
    </div>
  )
}

function sourceNote(source: TallySource, raters: number, hasJudgeReview: boolean): string {
  if (source === 'judge') return 'No jurors scored this case, so this is the judge’s own review. The judge knew which setups were in the case.'
  if (source === 'jury') return `From ${raters === 1 ? '1 juror’s worksheet' : `${raters} jurors’ worksheets`}, scored blind.${hasJudgeReview ? ' The judge’s own review is reported on its own under Findings.' : ''}`
  return ''
}

/** At the top of the record. A count of the scores, not the judgment. */
export function HeadlineSection({ data }: { data: ResultsView }) {
  const tally = recordTally(data)
  const showSplits = tally.source === 'jury' && findSplits(data).jurors >= 2
  const questionHref = (key: string) => `#q-${key}`
  return (
    <SheetSection
      id="headline"
      label={
        <>
          Headline <Plain>{tally.source === 'judge' ? 'from the judge’s own review' : 'from the jury’s scores'}</Plain>
        </>
      }
    >
      {tally.source === 'none' ? (
        <p className="text-sm text-muted-foreground">No worksheet was filed for this hearing, so there are no scores to count.</p>
      ) : (
        <div className="space-y-5">
          <HeadlineSummary tally={tally} questionHref={questionHref}>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {sourceNote(tally.source, tally.raters, data.cohorts.owner.reviewerCount > 0)} Each question is worth {tally.maxPerQuestion} points: three lines scored 0–2. This is a count, not the judgment.
              {showSplits && (
                <>
                  {' '}
                  <a href="#splits" className={cn(linkClass, 'inline-flex items-center gap-0.5')}>
                    Where the jury split <ArrowDown aria-hidden className="size-3" />
                  </a>
                </>
              )}
            </p>
          </HeadlineSummary>
          <HeadToHeadTable tally={tally} questionHref={questionHref} />
          <PairwiseTable tally={tally} />
        </div>
      )}
    </SheetSection>
  )
}
