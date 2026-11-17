/**
 * Loads a hearing's unsealed record for the Record, Judgment and Special
 * master dividers: a skeleton while loading, a plain "still sealed" notice
 * before unsealing, the shared error panel otherwise.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ErrorPanel } from '@/components/feedback/ErrorPanel'
import { PageSkeleton } from '@/components/feedback/PageSkeleton'
import { Page } from '@/components/layout/Page'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { RUBRICS } from '@/domain/rubric'
import type { ResultsView } from '@/lib/dto'
import { useApi } from '@/lib/use-api'

export function RecordGate({ runId, sealedText, children }: { runId: string; sealedText: string; children: (data: ResultsView, reload: () => Promise<void>) => ReactNode }) {
  const results = useApi<ResultsView>(`/runs/${runId}/results`)
  if (results.loading && !results.data) return <Page width="wide"><PageSkeleton label="Loading the record" /></Page>
  if (results.error && !results.data) {
    if (results.error.isConflict) {
      return (
        <Page>
          <Alert>
            <AlertTitle>The record is still sealed</AlertTitle>
            <AlertDescription>
              {sealedText}{' '}
              <Link className="underline" to={`/runs/${runId}`}>
                Back to the hearing
              </Link>
            </AlertDescription>
          </Alert>
        </Page>
      )
    }
    return <Page><ErrorPanel error={results.error} onRetry={results.reload} /></Page>
  }
  if (!results.data) return null
  return <>{children(results.data, results.reload)}</>
}

export function rubricName(version: string): string {
  return (RUBRICS as Record<string, { name: string }>)[version]?.name ?? version
}

/** "Selected: Party A", "Tie" or "Inconclusive". */
export function outcomeText(verdict: ResultsView['verdicts'][number], configurations: ResultsView['configurations']): string {
  if (verdict.outcome === 'selected') return `Selected: ${configurations.find((c) => c.key === verdict.selectedConfigurationKey)?.label ?? '—'}`
  return verdict.outcome === 'tie' ? 'Tie' : 'Inconclusive'
}
