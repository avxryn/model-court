import { AlertTriangle } from 'lucide-react'
import { SheetSection } from '@/components/court/CaseFile'
import { FindingsChart } from '@/components/court/FindingsChart'
import { Note, Plain } from '@/components/court/Paper'
import { FindingsTable } from '@/components/record/FindingsTable'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CohortResult } from '@/domain/rubric'
import type { ResultsView } from '@/lib/dto'
import { plural } from '@/lib/format'

/**
 * The jury's findings and the judge's own review, side by side and never
 * combined, then what to read with care. With no jurors the judge's review
 * is the result and comes first.
 */
export function FindingsSection({ data }: { data: ResultsView }) {
  const { invited, owner } = data.cohorts
  const solo = invited.reviewerCount === 0
  const juryTab = (
    <TabsTrigger key="invited" value="invited">
      Jury’s findings ({plural(invited.reviewerCount, 'juror')})
    </TabsTrigger>
  )
  const judgeTab = (
    <TabsTrigger key="owner" value="owner">
      Judge’s own review ({owner.reviewerCount})
    </TabsTrigger>
  )
  return (
    <>
      <SheetSection
        id="scores"
        label={
          <>
            Findings <Plain>scores from the jury and from the judge, kept apart</Plain>
          </>
        }
      >
        <Tabs defaultValue={solo ? 'owner' : 'invited'}>
          <TabsList className="h-auto flex-wrap">{solo ? [judgeTab, juryTab] : [juryTab, judgeTab]}</TabsList>
          <TabsContent value="invited" className="pt-3">
            <Cohort cohort={invited} data={data} />
          </TabsContent>
          <TabsContent value="owner" className="pt-3">
            <Cohort cohort={owner} data={data} />
            <p className="mt-2 text-xs text-muted-foreground">{solo ? 'No jurors scored this case, so this review is the result. ' : ''}The judge knew which setups were in the case when scoring. This review is reported on its own and never combined with the jury’s findings.</p>
          </TabsContent>
        </Tabs>
      </SheetSection>
      <ReadWithCare data={data} />
    </>
  )
}

function Cohort({ cohort, data }: { cohort: CohortResult; data: ResultsView }) {
  if (!cohort.byConfiguration) return <Note>No ratings in this group.</Note>
  return (
    <>
      <FindingsChart cohort={cohort} parties={data.configurations} rubricVersion={data.rubricVersion} />
      <FindingsTable cohort={cohort} parties={data.configurations} rubricVersion={data.rubricVersion} />
    </>
  )
}

function ReadWithCare({ data }: { data: ResultsView }) {
  const unblinded = data.cohorts.invited.potentiallyUnblindedCount + data.cohorts.owner.potentiallyUnblindedCount
  const eligible = data.eligibleCaseKeys.length
  if (unblinded === 0 && data.disagreements.length === 0 && eligible >= 3) return null
  return (
    <div className="border-t border-paper-rule px-5 py-6 sm:px-8">
      <Alert className="bg-slip">
        <AlertTriangle aria-hidden />
        <AlertTitle>Read these scores with care</AlertTitle>
        <AlertDescription>
          <ul className="list-disc space-y-0.5 pl-5">
            {eligible < 3 && <li>Only {plural(eligible, 'eligible question')}; the evidence is small.</li>}
            {unblinded > 0 && <li>{plural(unblinded, 'worksheet')} flagged a possible clue to a party’s identity (potentially unblinded).</li>}
            {data.disagreements.length > 0 && <li>Ratings disagreed (by 1+ point) on {plural(data.disagreements.length, 'question/party/line judgment')}; see the testimony below.</li>}
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  )
}
