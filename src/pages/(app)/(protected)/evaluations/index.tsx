import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { ErrorPanel, StaleNotice } from '@/components/feedback/ErrorPanel'
import { Page, PageHeader } from '@/components/layout/Page'
import { PageSkeleton } from '@/components/feedback/PageSkeleton'
import { NewCaseDialog } from '@/components/evaluations/NewCaseDialog'
import { Button } from '@/components/ui/button'
import { CaseList } from '@/components/dashboard/CaseList'
import { EmptyDocket } from '@/components/dashboard/EmptyDocket'
import { StatCards } from '@/components/dashboard/StatCards'
import { WaitingOnYou } from '@/components/dashboard/WaitingOnYou'
import { docketStats, waitingItems, waitingSentence } from '@/components/dashboard/docket'
import { useDocket } from '@/components/dashboard/use-docket'

const ABOUT = 'Compare AI setups on your own questions, have a jury score the answers blind, then enter judgment.'

function NewCaseButton() {
  return (
    <NewCaseDialog
      trigger={
        <Button size="lg">
          <Plus aria-hidden /> New case
        </Button>
      }
    />
  )
}

export default function EvaluationsPage() {
  const { first, items, hasMore, loadMore, loadingMore, moreError } = useDocket()
  const waiting = useMemo(() => waitingItems(items), [items])
  const stats = useMemo(() => docketStats(items, waiting), [items, waiting])
  const loaded = first.data !== null
  const empty = loaded && items.length === 0

  return (
    <Page width="wide">
      <PageHeader title="Your cases" description={loaded && !empty ? waitingSentence(waiting.length) : ABOUT} actions={empty ? undefined : <NewCaseButton />} />
      {first.stale && <StaleNotice onRetry={first.reload} />}
      {first.loading && !loaded ? (
        <PageSkeleton label="Loading your cases" />
      ) : first.error && !loaded ? (
        <ErrorPanel error={first.error} onRetry={first.reload} />
      ) : empty ? (
        <EmptyDocket newCase={<NewCaseButton />} />
      ) : (
        <>
          <StatCards stats={stats} />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* First in reading order so small screens see the next steps before the long list. */}
            <WaitingOnYou items={waiting} className="lg:col-start-2 lg:row-start-1" />
            <div className="lg:col-start-1 lg:row-start-1">
              <CaseList items={items} hasMore={hasMore} onLoadMore={() => void loadMore()} loadingMore={loadingMore} moreError={moreError} />
            </div>
          </div>
        </>
      )}
    </Page>
  )
}
