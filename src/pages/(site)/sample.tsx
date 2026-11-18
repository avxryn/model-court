/**
 * Public, keyless sample (F19), in the public site layout.
 * It makes no API or provider request of its own; practice ratings live only
 * in this page's memory.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, FlaskConical, RotateCcw } from 'lucide-react'
import { Caption, CaseStage, DocketNumber, Sheet, Stamp } from '@/components/court/CaseFile'
import { FindingsChart } from '@/components/court/FindingsChart'
import { CaseFolder } from '@/components/court/Folder'
import { JudgeSignature } from '@/components/court/JudgeSignature'
import { Note } from '@/components/court/Paper'
import { SITE_CONTAINER } from '@/components/site/SiteChrome'
import { FindingsTable } from '@/components/record/FindingsTable'
import { formatPoints, tallyQuestions } from '@/components/record/headline'
import { HeadlineSummary } from '@/components/record/HeadlineSection'
import { CaseMaterial, ResponseCard } from '@/components/review/CaseEvidence'
import { emptyRating, RubricForm } from '@/components/review/RubricForm'
import { QuestionPager, QuestionStepper, useWorksheetKeys, WorksheetGrid, WorksheetKeyLegend } from '@/components/review/Worksheet'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DraftRating } from '@/domain/contracts'
import { DIMENSIONS, scoreCohort, submissionIssues, type CompleteRating } from '@/domain/rubric'
import { cn } from '@/lib/utils'
import { SAMPLE_CASES, SAMPLE_CONFIGURATIONS, SAMPLE_PROVENANCE, SAMPLE_VERDICT } from '@/sample/fixture'

export default function SamplePage() {
  const [ratings, setRatings] = useState<Record<string, DraftRating>>({})
  const [caseIndex, setCaseIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const current = SAMPLE_CASES[caseIndex]
  const responseIds = useMemo(() => SAMPLE_CASES.flatMap((c) => c.responses.map((r) => r.responseId)), [])
  const issues = submissionIssues(responseIds, Object.values(ratings))
  const complete = issues.length === 0
  const notesMissing = issues.filter((issue) => issue.kind === 'note_required').length
  const isScored = (id: string) => DIMENSIONS.every((d) => ratings[id]?.[d] !== null && ratings[id]?.[d] !== undefined)
  const scoredCount = responseIds.filter(isScored).length
  const caseScored = (index: number) => SAMPLE_CASES[index].responses.every((r) => isScored(r.responseId))
  const labelFor = (key: string) => SAMPLE_CONFIGURATIONS.find((c) => c.key === key)?.label ?? key
  const pointsFor = (id: string) => DIMENSIONS.reduce((sum, d) => sum + (ratings[id]?.[d] ?? 0), 0)

  // The record's headline over your practice scores: the same count a judge sees.
  const tally = useMemo(
    () =>
      tallyQuestions(
        SAMPLE_CONFIGURATIONS,
        SAMPLE_CASES.map((c, index) => ({
          key: c.key,
          number: index + 1,
          title: c.title,
          judgments: c.responses.map((r) => ({ reviewer: 'You', configurationKey: r.configurationKey, correctness: ratings[r.responseId]?.correctness ?? null, completeness: ratings[r.responseId]?.completeness ?? null, grounding: ratings[r.responseId]?.grounding ?? null })),
        })),
      ),
    [ratings],
  )

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
    <div className={cn(SITE_CONTAINER, 'py-6 lg:py-8')}>
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
                <CaseStage step={revealed ? 'judgment' : 'deliberate'} name={revealed ? 'Judgment (example)' : undefined} />
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
                  <span id="sample-unseal-status" aria-live="polite" className="text-xs text-muted-foreground tabular-nums">
                    {scoredCount} of {responseIds.length} testimonies scored
                    {scoredCount < responseIds.length ? ' · score every line to unseal' : notesMissing > 0 ? ` · add a note for each 0 (${notesMissing} missing)` : ''}
                  </span>
                  <Button disabled={!complete} aria-describedby="sample-unseal-status" onClick={() => setRevealed(true)}>
                    Unseal the record
                  </Button>
                </QuestionStepper>
              </>
            ) : (
              <div className="space-y-10">
                <section aria-labelledby="sample-headline">
                  <h2 id="sample-headline" className="court-label mb-4">
                    Headline from your scores
                  </h2>
                  <HeadlineSummary tally={tally} questionHref={(key) => `#q-${key}`}>
                    <p className="text-xs leading-relaxed text-muted-foreground">Each question is worth {tally.maxPerQuestion} points: three lines scored 0–2. In a real case this counts the jury’s scores; it is a count, not the judgment.</p>
                  </HeadlineSummary>
                </section>

                <section aria-labelledby="sample-mapping">
                  <h2 id="sample-mapping" className="court-label mb-4">
                    Who gave which testimony
                  </h2>
                  <div className="overflow-hidden exhibit-panel">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="px-2 whitespace-normal sm:px-3">Question</TableHead>
                          <TableHead className="px-2 whitespace-normal sm:px-3">Testimony A: party and your score</TableHead>
                          <TableHead className="px-2 whitespace-normal sm:px-3">Testimony B: party and your score</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {SAMPLE_CASES.map((c, index) => {
                          const question = tally.questions.find((q) => q.key === c.key)
                          return (
                            <TableRow key={c.key} id={`q-${c.key}`} className="scroll-mt-24">
                              <TableCell className="min-w-20 px-2 font-medium whitespace-normal sm:px-3">
                                Q{index + 1}: {c.title}
                              </TableCell>
                              {c.responses.map((r) => {
                                const won = question?.winner === r.configurationKey
                                return (
                                  <TableCell key={r.responseId} className="min-w-26 px-2 align-top whitespace-normal sm:px-3">
                                    <span className="block">{labelFor(r.configurationKey)}</span>
                                    <span className={cn('mt-0.5 inline-flex items-center gap-1 text-xs tabular-nums', won ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                                      {won && <Check aria-hidden className="size-3.5 text-primary" />}
                                      {formatPoints(pointsFor(r.responseId))} of {tally.maxPerQuestion} ({DIMENSIONS.map((d) => ratings[r.responseId]?.[d] ?? '–').join(' · ')})
                                      {won && <span className="sr-only"> (higher on this question)</span>}
                                      {question && !question.winner && <span> · tied</span>}
                                    </span>
                                  </TableCell>
                                )
                              })}
                            </TableRow>
                          )
                        })}
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
                    Judgment (example)
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
    </div>
  )
}
