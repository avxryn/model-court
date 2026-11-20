/**
 * Proceedings (A divider): the hearing's live state for the judge. While
 * testimony is taken, generation comes first; once deliberation opens, the
 * jury comes first and generation folds to one line below it.
 */

import { useCallback, useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Wifi, WifiOff } from 'lucide-react'
import { Caption, DocketNumber, Sheet, Stamp } from '@/components/court/CaseFile'
import { HearingFolder, StageLine } from '@/components/court/HearingNav'
import { ErrorPanel, StaleNotice } from '@/components/feedback/ErrorPanel'
import { PageSkeleton } from '@/components/feedback/PageSkeleton'
import { GenerationSection } from '@/components/hearing/GenerationSection'
import { HearingActions } from '@/components/hearing/HearingActions'
import { JuryPanel } from '@/components/hearing/JuryPanel'
import { useHearingAction } from '@/components/hearing/use-hearing-action'
import { Page } from '@/components/layout/Page'
import { docketNumber, recordStamp } from '@/lib/court'
import type { OwnerRunView, RunView } from '@/lib/dto'
import { formatTime } from '@/lib/format'
import { useNoticeRefresh } from '@/lib/notices'
import { isActive } from '@/lib/status'
import { useApi } from '@/lib/use-api'

export default function RunPage() {
  const { id = '' } = useParams()
  // 15s authorized reconciliation only while work is active (spec §10.1, notice loss).
  const [active, setActive] = useState(true)
  const run = useApi<RunView>(`/runs/${id}`, { pollMs: active ? 15_000 : undefined })
  const { reload } = run
  const refresh = useCallback(() => void reload(), [reload])
  const { live } = useNoticeRefresh(id, refresh)
  const status = run.data?.status
  useEffect(() => {
    if (status) setActive(isActive(status))
  }, [status])

  if (run.loading && !run.data) return <Page width="wide"><PageSkeleton variant="sheet" label="Loading the hearing" /></Page>
  if (run.error && !run.data) return <Page><ErrorPanel error={run.error} onRetry={run.reload} /></Page>
  if (!run.data) return null
  return (
    <Page width="wide">
      {run.stale && <StaleNotice onRetry={run.reload} />}
      {run.data.role === 'owner' ? <Proceedings run={run.data} reload={run.reload} live={live} /> : <Navigate to={`/runs/${run.data.runId}/review`} replace />}
    </Page>
  )
}

function Proceedings({ run, reload, live }: { run: OwnerRunView; reload: () => Promise<void>; live: boolean }) {
  const { busy, act } = useHearingAction(reload)
  const stamp = recordStamp(run.status)
  const deliberating = run.status === 'reviewing' || run.status === 'revealed' || run.status === 'decided'
  const generation = <GenerationSection run={run} busy={busy} act={act} folded={deliberating} />
  return (
    <HearingFolder runId={run.runId} caseId={run.evaluationId} caseTitle={run.evaluationTitle} role="owner" status={run.status} actions={<HearingActions run={run} busy={busy} act={act} />}>
      <Sheet>
        <Caption
          title={run.evaluationTitle}
          parties={run.configurations.map((c) => c.label)}
          details={
            <>
              <div>
                Case no. <DocketNumber>{docketNumber(run.evaluationId)}</DocketNumber>
              </div>
              <div>Hearing · {formatTime(run.createdAt)}</div>
              <StageLine status={run.status} />
              <div className="text-caption leading-snug text-muted-foreground">{run.comparisonMode === 'model' ? 'Model comparison: identical instructions, different models.' : 'Configuration comparison: instructions and models may differ; not an isolated model-quality test.'}</div>
              <div className="mt-1 inline-flex items-center gap-1 font-sans text-caption text-muted-foreground" title={live ? 'Live updates connected' : 'Live updates reconnecting; refreshing every 15 seconds'}>
                {live ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
                {live ? 'Live' : 'Reconnecting'}
              </div>
            </>
          }
          stamp={stamp && <Stamp kind={stamp} />}
        />
        {deliberating ? (
          <>
            <JuryPanel run={run} busy={busy} act={act} />
            {generation}
          </>
        ) : (
          generation
        )}
      </Sheet>
    </HearingFolder>
  )
}
