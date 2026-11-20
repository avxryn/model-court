import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { docketNumber } from '@/lib/court'
import type { EvaluationSummary } from '@/lib/dto'
import { formatTime, plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { caseChip, relativeAge, type ChipTone } from './docket'

const CHIP: Record<ChipTone, string> = {
  muted: 'bg-muted text-muted-foreground',
  open: 'bg-accent text-accent-foreground',
  seal: 'bg-stamp/10 text-stamp',
  delib: 'bg-warning/10 text-warning',
  done: 'bg-success/10 text-success',
}

/** A rounded status chip with a dot; the label carries the meaning, the color only echoes it. */
export function CaseChip({ item }: { item: Parameters<typeof caseChip>[0] }) {
  const { label, tone } = caseChip(item)
  return (
    <span className={cn('inline-flex h-5.5 items-center gap-1.5 rounded-full px-2 text-caption font-medium whitespace-nowrap', CHIP[tone])}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

function Age({ ms, now }: { ms: number; now: number }) {
  return (
    <time dateTime={new Date(ms).toISOString()} title={formatTime(ms)}>
      {relativeAge(ms, now)}
    </time>
  )
}

/** The docket: one card, newest activity first, each row a link to its case. */
export function CaseList({ items, hasMore, onLoadMore, loadingMore, moreError }: { items: EvaluationSummary[]; hasMore: boolean; onLoadMore: () => void; loadingMore: boolean; moreError: string | null }) {
  const [now] = useState(() => Date.now())
  return (
    <section aria-labelledby="docket-cases" className="paper overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <h2 id="docket-cases" className="text-small font-semibold text-foreground">
          Cases
        </h2>
        <span className="ml-auto text-small text-muted-foreground">Sorted by last activity</span>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={`/evaluations/${item.id}`}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-3.5 outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_auto_5.5rem_1rem]"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{item.title}</span>
                <span className="mt-0.5 block truncate text-small text-muted-foreground">
                  <span className="font-mono text-caption tracking-wide">{docketNumber(item.id)}</span>
                  <span> · {item.role === 'owner' ? 'Presiding' : 'Jury duty'}</span>
                  <span className="tabular-nums sm:hidden">
                    {' · '}
                    <Age ms={item.updatedAt} now={now} />
                  </span>
                </span>
              </span>
              <CaseChip item={item} />
              <span className="hidden text-right text-small text-muted-foreground tabular-nums sm:block">
                <Age ms={item.updatedAt} now={now} />
              </span>
              <ChevronRight aria-hidden className="hidden size-4 text-muted-foreground transition-colors group-hover:text-foreground sm:block" />
            </Link>
          </li>
        ))}
      </ul>
      {(hasMore || moreError) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3">
          <span className="text-small text-muted-foreground">Showing {plural(items.length, 'case')}. The counts above cover these.</span>
          {moreError && (
            <span role="alert" className="text-small text-destructive">
              {moreError}
            </span>
          )}
          {hasMore && (
            <Button variant="outline" size="sm" className="ml-auto" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? 'Loading…' : moreError ? 'Try again' : 'Load more'}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
