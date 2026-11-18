/**
 * The Special master divider (D-40, D-46): an advisory AI grader on the
 * judge's own key, checked against the jury first. Judge only, after unsealing.
 */

import { Navigate, useParams } from 'react-router-dom'
import { Sheet } from '@/components/court/CaseFile'
import { HearingFolder } from '@/components/court/HearingNav'
import { Plain } from '@/components/court/Paper'
import { Page } from '@/components/layout/Page'
import { RecordGate } from '@/components/record/RecordGate'
import { SpecialMasterPanel } from '@/components/review/SpecialMasterPanel'

export default function SpecialMasterPage() {
  const { id = '' } = useParams()
  return (
    <RecordGate runId={id} sealedText="The special master can grade the testimony after the judge unseals the record.">
      {(data) =>
        data.role !== 'owner' ? (
          <Navigate to={`/runs/${data.runId}/results`} replace />
        ) : (
          <Page width="wide">
            <HearingFolder runId={data.runId} caseId={data.evaluationId} caseTitle={data.evaluationTitle} role="owner" status={data.status}>
              <Sheet>
                <header className="space-y-1.5 border-b border-paper-rule px-5 pt-7 pb-6 sm:px-8">
                  <div className="court-label">
                    Special master <Plain>an advisory AI grader, visible only to you</Plain>
                  </div>
                  <h1 className="font-display text-2xl leading-tight font-medium tracking-tight sm:text-3xl">Check an AI grader against the jury</h1>
                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">An AI model scores each testimony on the same rubric, one testimony at a time, without knowing which party gave it. It uses your own API key. Its scores are advisory: they never change the jury’s findings or your judgment. Check how often it agrees with the jury before relying on it.</p>
                </header>
                <SpecialMasterPanel results={data} />
              </Sheet>
            </HearingFolder>
          </Page>
        )
      }
    </RecordGate>
  )
}
