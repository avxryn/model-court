/**
 * The record (C divider): the headline count, who each party was, the findings, cost and speed, the judgment,
 * the testimony, and reliability. Entering judgment, the certified record
 * and the special master live on their own dividers.
 */

import { useParams } from 'react-router-dom'
import { Caption, Sheet, SheetIndex, Stamp } from '@/components/court/CaseFile'
import { HearingFolder, StageLine } from '@/components/court/HearingNav'
import { Page } from '@/components/layout/Page'
import { DisagreementSection, findSplits } from '@/components/record/DisagreementSection'
import { FindingsSection } from '@/components/record/FindingsSection'
import { HeadlineSection } from '@/components/record/HeadlineSection'
import { PartiesSection } from '@/components/record/PartiesSection'
import { RecordGate, rubricName } from '@/components/record/RecordGate'
import { ReliabilitySection } from '@/components/record/ReliabilitySection'
import { SetupSection } from '@/components/record/SetupSection'
import { TestimonySection } from '@/components/record/TestimonySection'
import { JudgmentSummary } from '@/components/record/Verdict'
import type { ResultsView } from '@/lib/dto'
import { formatTime, plural } from '@/lib/format'

export default function ResultsPage() {
  const { id = '' } = useParams()
  return (
    <RecordGate runId={id} sealedText="It opens after the judge unseals it.">
      {(data) => <Record data={data} />}
    </RecordGate>
  )
}

function Record({ data }: { data: ResultsView }) {
  return (
    <Page width="wide">
      <HearingFolder runId={data.runId} caseId={data.evaluationId} caseTitle={data.evaluationTitle} role={data.role} status={data.status}>
        <Sheet>
          <Caption
            title={data.evaluationTitle}
            parties={data.configurations.map((c) => c.label)}
            details={
              <>
                <div>Hearing · {formatTime(data.createdAt)}</div>
                <div>Unsealed · {formatTime(data.revealedAt)}</div>
                <StageLine status={data.status} />
                <div>Rubric · {rubricName(data.rubricVersion)}</div>
                <div className="text-xs leading-snug text-muted-foreground">Scores are 0–2 means over {plural(data.eligibleCaseKeys.length, 'eligible question')}. The headline counts scores; only the judge enters judgment.</div>
              </>
            }
            stamp={<Stamp kind={data.status === 'decided' ? 'entered' : 'unsealed'} />}
          />
          <SheetIndex
            items={[
              { id: 'headline', label: 'Headline' },
              { id: 'mapping', label: 'Parties' },
              { id: 'scores', label: 'Findings' },
              { id: 'setup', label: 'Cost and speed' },
              { id: 'verdict', label: 'Judgment' },
              ...(findSplits(data).jurors >= 2 ? [{ id: 'splits', label: 'Splits' }] : []),
              { id: 'evidence', label: 'Testimony' },
              { id: 'coverage', label: 'Reliability' },
            ]}
          />
          <HeadlineSection data={data} />
          <PartiesSection data={data} />
          <FindingsSection data={data} />
          <SetupSection data={data} />
          <JudgmentSummary data={data} />
          <DisagreementSection data={data} />
          <TestimonySection data={data} />
          <ReliabilitySection data={data} />
        </Sheet>
      </HearingFolder>
    </Page>
  )
}
