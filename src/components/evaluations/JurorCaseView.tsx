import { Caption, DocketNumber, Sheet } from '@/components/court/CaseFile'
import { HearingList } from '@/components/evaluations/HearingList'
import { Breadcrumbs, Page } from '@/components/layout/Page'
import { useShellFocus } from '@/components/shell/ShellContext'
import { docketNumber } from '@/lib/court'
import type { EvaluationView } from '@/lib/dto'
import { isUnsealed } from '@/lib/status'

/** A case as a juror sees it: sealed parties and a link to each hearing's worksheet or record. */
export function JurorCaseView({ evaluation }: { evaluation: Extract<EvaluationView, { role: 'reviewer' }> }) {
  useShellFocus(evaluation.id)
  return (
    <Page>
      <Breadcrumbs items={[{ label: 'Your cases', to: '/evaluations' }, { label: evaluation.title }]} />
      <Sheet>
        <Caption
          title={evaluation.title}
          parties={['Sealed party', 'Sealed party']}
          details={
            <>
              <div>
                Case no. <DocketNumber>{docketNumber(evaluation.id)}</DocketNumber>
              </div>
              <div>
                Seated: <span className="italic">you, as a juror</span>
              </div>
            </>
          }
        />
        <div className="space-y-4 px-5 pb-10 sm:px-8">
          <p className="font-heading text-base leading-relaxed">You were summoned as a juror in this case. The parties stay sealed until the judge unseals the record. Open a hearing for your worksheet, or for the record once it is unsealed.</p>
          <HearingList runs={evaluation.runs} to={(run) => (isUnsealed(run.status) ? `/runs/${run.id}/results` : `/runs/${run.id}/review`)} />
        </div>
      </Sheet>
    </Page>
  )
}
