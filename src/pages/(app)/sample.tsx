/**
 * Public, keyless sample (F19), inside the app shell so it keeps the sidebar.
 * It makes no API or provider request of its own; practice ratings live only
 * in this page's memory.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical, RotateCcw } from 'lucide-react'
import { Caption, CaseStage, DocketNumber, Sheet, Stamp } from '@/components/court/CaseFile'
import { FindingsChart } from '@/components/court/FindingsChart'
import { CaseFolder } from '@/components/court/Folder'
import { JudgeSignature } from '@/components/court/JudgeSignature'
import { Note } from '@/components/court/Paper'
import { Breadcrumbs, Page } from '@/components/layout/Page'
import { FindingsTable } from '@/components/record/FindingsTable'
import { CaseMaterial, ResponseCard } from '@/components/review/CaseEvidence'
import { emptyRating, RubricForm } from '@/components/review/RubricForm'
import { QuestionPager, QuestionStepper, useWorksheetKeys, WorksheetGrid, WorksheetKeyLegend } from '@/components/review/Worksheet'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DraftRating } from '@/domain/contracts'
import { DIMENSIONS, scoreCohort, submissionIssues, type CompleteRating } from '@/domain/rubric'
import { SAMPLE_CASES, SAMPLE_CONFIGURATIONS, SAMPLE_PROVENANCE, SAMPLE_VERDICT } from '@/sample/fixture'

export default function SamplePage() {
  const [ratings, setRatings] = useState<Record<string, DraftRating>>({})
  const [caseIndex, setCaseIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const current = SAMPLE_CASES[caseIndex]
  const responseIds = useMemo(() => SAMPLE_CASES.flatMap((c) => c.responses.map((r) => r.responseId)), [])
  const complete = submissionIssues(responseIds, Object.values(ratings)).length === 0
  const isScored = (id: string) => DIMENSIONS.every((d) => ratings[id]?.[d] !== null && ratings[id]?.[d] !== undefined)
  const scoredCount = responseIds.filter(isScored).length
  const caseScored = (index: number) => SAMPLE_CASES[index].responses.every((r) => isScored(r.responseId))
  const labelFor = (key: string) => SAMPLE_CONFIGURATIONS.find((c) => c.key === key)?.label ?? key

  const practice = useMemo(() => {
    if (!complete) return null
    return scoreCohort(
      'invited',
      SAMPLE_CASES.map((c) => c.key),
      SAMPLE_CONFIGURATIONS.map((c) => c.key),
      [
        {
          sessionId: 'practice',
          contextType: 'invited',
          identityClueFlag: false,
          responses: SAMPLE_CASES.flatMap((c) => c.responses.map((r) => ({ caseKey: c.key, responseId: r.responseId, configurationKey: r.configurationKey }))),
          ratings: Object.values(ratings) as CompleteRating[],
        },
      ],
    )
  }, [complete, ratings])

  const reset = () => {
    setRatings({})
    setCaseIndex(0)
    setRevealed(false)
  }

  const goTo = (index: number) => {
    setCaseIndex(index)
    window.scrollTo({ top: 0 })
  }
  useWorksheetKeys({
    onNextQuestion: !revealed && caseIndex < SAMPLE_CASES.length - 1 ? () => goTo(caseIndex + 1) : undefined,
    onPreviousQuestion: !revealed && caseIndex > 0 ? () => goTo(caseIndex - 1) : undefined,
  })

  return (
    <Page width="wide">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Breadcrumbs items={[{ label: 'Learn' }, { label: 'Sample case' }]} />
        <Button size="sm" variant="outline" className="mb-3" render={<Link to="/evaluations" />} nativeButton={false}>
          Open your own case
        </Button>
      </div>
        <CaseFolder docket="MC-SAMPLE" title="Support policy answers">
        <Sheet>
          <Caption
            title="Support policy answers"
            parties={revealed ? [SAMPLE_CONFIGURATIONS[0].label, SAMPLE_CONFIGURATIONS[1].label] : ['Sealed party', 'Sealed party']}
            details={
              <>
                <div>
                  Case no. <DocketNumber>MC-SAMPLE</DocketNumber>
                </div>
                <div>Practice hearing · illustrative</div>
                <CaseStage step={revealed ? 'judgment' : 'deliberate'} />
                <div>
                  Presiding: <span className="italic">you, as judge</span>
                </div>
                <div>Jury: none (practice)</div>
              </>
            }
            stamp={revealed ? <Stamp kind="unsealed" animate /> : <Stamp kind="sealed" />}
          />

          <div className="space-y-8 px-5 pb-10 sm:px-8">
            <Alert className="bg-slip">
              <FlaskConical aria-hidden />
              <AlertTitle>Illustrative sample</AlertTitle>
              <AlertDescription>
                {SAMPLE_PROVENANCE} Your practice ratings stay in this browser tab and are never saved as evidence.
              </AlertDescription>
            </Alert>

            {!revealed ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <QuestionPager count={SAMPLE_CASES.length} current={caseIndex} isDone={caseScored} onSelect={goTo} />
                  <WorksheetKeyLegend />
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <RotateCcw aria-hidden /> Reset sample
                  </Button>
                </div>

                <WorksheetGrid material={<CaseMaterial title={current.title} input={current.input} reference={current.reference} expectedBehavior={current.expectedBehavior} number={caseIndex + 1} total={SAMPLE_CASES.length} />}>
                  {current.responses.map((response) => (
                    <ResponseCard key={response.responseId} label={response.label} text={response.text}>
                      <RubricForm label={response.label} rating={ratings[response.responseId] ?? emptyRating(response.responseId)} onChange={(next) => setRatings((r) => ({ ...r, [next.responseId]: next }))} />
                    </ResponseCard>
                  ))}
                </WorksheetGrid>

                <QuestionStepper current={caseIndex} count={SAMPLE_CASES.length} onGo={goTo}>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {scoredCount} of {responseIds.length} testimonies scored
                  </span>
                  <Button onClick={() => setRevealed(true)}>Unseal the record</Button>
                </QuestionStepper>
              </>
            ) : (
              <div className="space-y-10">
                <section aria-labelledby="sample-mapping">
                  <h2 id="sample-mapping" className="court-label mb-4">
                    Who gave which testimony
                  </h2>
                  <div className="overflow-hidden exhibit-panel">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Question</TableHead>
                          <TableHead>Testimony A</TableHead>
                          <TableHead>Testimony B</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {SAMPLE_CASES.map((c) => (
                          <TableRow key={c.key}>
                            <TableCell className="font-medium">{c.title}</TableCell>
                            {c.responses.map((r) => (
                              <TableCell key={r.responseId}>{labelFor(r.configurationKey)}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <ul className="mt-4 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
                    {SAMPLE_CONFIGURATIONS.map((c) => (
                      <li key={c.key}>
                        <span className="font-medium text-foreground">{c.label}:</span> {c.description}
                      </li>
                    ))}
                  </ul>
                </section>

                <section aria-labelledby="sample-scores">
                  <h2 id="sample-scores" className="court-label mb-4">
                    Your practice findings
                  </h2>
                  {practice?.byConfiguration ? (
                    <>
                    <FindingsChart cohort={practice} parties={SAMPLE_CONFIGURATIONS} />
                    <FindingsTable cohort={practice} parties={SAMPLE_CONFIGURATIONS} markHighest={false} />
                    </>
                  ) : (
                    <Note className="leading-relaxed">
                      Score every testimony on all three lines (with a note for any 0) to see practice findings. In a real hearing, findings appear only for filed worksheets.
                    </Note>
                  )}
                </section>

                <section aria-labelledby="sample-verdict" className="relative exhibit-panel px-6 pt-6 pb-8 sm:px-8">
                  <h2 id="sample-verdict" className="court-label">
                    Example judgment
                  </h2>
                  <p className="mt-3 font-display text-2xl leading-snug font-medium">{SAMPLE_VERDICT.outcome}</p>
                  <p className="mt-3 max-w-3xl font-heading leading-relaxed">{SAMPLE_VERDICT.rationale}</p>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">Limitations: {SAMPLE_VERDICT.limitations}</p>
                  <div className="mt-8">
                    <JudgeSignature note="Signature · practice only" stamp={<Stamp kind="entered" detail="ILLUSTRATIVE" />} />
                  </div>
                </section>

                <div className="flex flex-wrap gap-3">
                  <Button render={<Link to="/evaluations" />} nativeButton={false}>
                    Open a case with your own keys
                  </Button>
                  <Button variant="outline" onClick={reset}>
                    Start the sample over
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Sheet>
        </CaseFolder>
    </Page>
  )
}
