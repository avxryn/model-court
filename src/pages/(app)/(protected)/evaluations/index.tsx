import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Folder, FolderOpen } from 'lucide-react'
import { EmptyState as EmptyPanel } from '@/components/feedback/EmptyState'
import { ErrorPanel, StaleNotice } from '@/components/feedback/ErrorPanel'
import { formatTime } from '@/lib/format'
import { Page, PageHeader } from '@/components/layout/Page'
import { PageSkeleton } from '@/components/feedback/PageSkeleton'
import { StatusBadge } from '@/components/status/StatusBadge'
import { DocketNumber, Sheet, Term } from '@/components/court/CaseFile'
import { NewCaseDialog } from '@/components/evaluations/NewCaseDialog'
import { Button } from '@/components/ui/button'
import { docketNumber } from '@/lib/court'
import type { EvaluationSummary } from '@/lib/dto'
import { useApi } from '@/lib/use-api'

export default function EvaluationsPage() {
  const [cursor, setCursor] = useState<string | null>(null)
  const list = useApi<{ items: EvaluationSummary[]; nextCursor: string | null }>(`/evaluations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)

  return (
    <Page>
      <PageHeader
        eyebrow={<Term name="docket" />}
        title="Your cases"
        description="Compare AI setups on your own questions, have a jury score the answers blind, then enter judgment."
        actions={list.data && list.data.items.length === 0 && !cursor ? undefined : <NewCaseDialog />}
      />
      {list.stale && <StaleNotice onRetry={list.reload} />}
      {list.loading && !list.data ? (
        <PageSkeleton label="Loading your cases" />
      ) : list.error && !list.data ? (
        <ErrorPanel error={list.error} onRetry={list.reload} />
      ) : list.data && list.data.items.length === 0 && !cursor ? (
        <EmptyState />
      ) : (
        <>
          <div className="space-y-8">
            <CaseDrawer title="Presiding" note="Cases you set up and judge" items={list.data?.items.filter((item) => item.role === 'owner') ?? []} />
            <CaseDrawer title="Jury duty" note="Cases you were summoned to" items={list.data?.items.filter((item) => item.role === 'reviewer') ?? []} />
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" size="sm" disabled={!cursor} onClick={() => setCursor(null)}>
              First page
            </Button>
            <Button variant="outline" size="sm" disabled={!list.data?.nextCursor} onClick={() => setCursor(list.data?.nextCursor ?? null)}>
              Older cases
            </Button>
          </div>
        </>
      )}
    </Page>
  )
}

/** One drawer of case folders. Hidden when empty, unless it is the judge's own. */
function CaseDrawer({ title, note, items }: { title: string; note: string; items: EvaluationSummary[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby={`drawer-${title}`}>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 id={`drawer-${title}`} className="court-label">
          {title}
        </h2>
        <span className="text-xs text-muted-foreground">{note}</span>
      </div>
      <Sheet as="div" margin={false}>
        <ul className="divide-y divide-paper-rule">
          {items.map((item) => (
            <li key={item.id}>
              <Link to={`/evaluations/${item.id}`} className="group flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-slip focus-visible:bg-slip focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:gap-4 sm:px-5">
                <Folder className="size-5 shrink-0 text-manila-foreground/70 group-hover:hidden" strokeWidth={1.5} aria-hidden />
                <FolderOpen className="hidden size-5 shrink-0 text-manila-foreground group-hover:block" strokeWidth={1.5} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-heading text-base">
                    <span className="italic">In re:</span> <span className="font-bold">{item.title}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    <DocketNumber>{docketNumber(item.id)}</DocketNumber>
                    <span className="tabular-nums"> · updated {formatTime(item.updatedAt)}</span>
                  </span>
                </span>
                <span className="shrink-0">{item.latestRunStatus ? <StatusBadge status={item.latestRunStatus} /> : <span className="text-xs text-muted-foreground">No hearings yet</span>}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </section>
  )
}

function EmptyState() {
  return (
    <EmptyPanel
      title="Open your first case"
      actions={
        <>
          <NewCaseDialog />
          <Button variant="outline" render={<Link to="/sample" />} nativeButton={false}>
            Explore the sample
          </Button>
        </>
      }
    >
      <p>Pick a starter template, edit the questions, and add your provider keys. The sample case shows the whole process without keys.</p>
    </EmptyPanel>
  )
}
