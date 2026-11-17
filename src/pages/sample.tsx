/**
 * Public, keyless sample (F19). Static tier: no auth fetch, no WebSocket, no
 * provider or API requests. Practice ratings live only in this page's memory.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, ChevronRight, FlaskConical, RotateCcw } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { Caption, CaseProgress, DocketNumber, Sheet, Stamp, Term } from '@/components/court/CaseFile'
import { CaseMaterial, ResponseCard } from '@/components/review/CaseEvidence'
import { emptyRating, RubricForm } from '@/components/review/RubricForm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DraftRating } from '@/domain/contracts'
import { DIMENSIONS, formatScore, RUBRIC, scoreCohort, submissionIssues, type CompleteRating } from '@/domain/rubric'
import { SAMPLE_CASES, SAMPLE_CONFIGURATIONS, SAMPLE_PROVENANCE, SAMPLE_VERDICT } from '@/sample/fixture'
import { cn } from '@/lib/utils'

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

  return (
    <div className="min-h-screen bg-desk">
      <header className="border-b border-paper-edge/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <BrandMark />
          </Link>
          <Button size="sm" variant="outline" render={<Link to="/evaluations" />} nativeButton={false}>
            Open your own case
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-6">
        <CaseProgress step={revealed ? 'judgment' : 'deliberate'} />
        <Sheet className="rounded-t-none">
          <Caption
            title="Support policy answers"
            parties={revealed ? [SAMPLE_CONFIGURATIONS[0].label, SAMPLE_CONFIGURATIONS[1].label] : ['Sealed party', 'Sealed party']}
            details={
              <>
                <div>
                  Case no. <DocketNumber>MC-SAMPLE</DocketNumber>
                </div>
                <div>Practice hearing · illustrative</div>
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
                  <nav aria-label="Questions" className="flex max-w-full flex-wrap gap-1">
                    {SAMPLE_CASES.map((c, index) => (
                      <Button
                        key={c.key}
                        size="sm"
                        variant="ghost"
                        className={cn('h-9 px-3 font-heading', index === caseIndex ? 'bg-foreground text-paper hover:bg-foreground hover:text-paper' : 'text-muted-foreground hover:bg-slip')}
                        aria-current={index === caseIndex ? 'step' : undefined}
                        onClick={() => goTo(index)}
                      >
                        {caseScored(index) && <CheckCircle2 aria-label="scored" className={index === caseIndex ? 'text-paper' : 'text-success'} />}Q{index + 1}
                      </Button>
                    ))}
                  </nav>
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <RotateCcw aria-hidden /> Reset sample
                  </Button>
                </div>

                <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                  <div className="lg:sticky lg:top-4 lg:self-start">
                    <CaseMaterial title={current.title} input={current.input} reference={current.reference} expectedBehavior={current.expectedBehavior} number={caseIndex + 1} total={SAMPLE_CASES.length} />
                  </div>
                  <div className="space-y-3">
                    <h2 className="court-label">
                      <Term name="testimony" />
                    </h2>
                    <div className="grid gap-6 xl:grid-cols-2">
                      {current.responses.map((response) => (
                        <ResponseCard key={response.responseId} label={response.label} text={response.text}>
                          <RubricForm label={response.label} rating={ratings[response.responseId] ?? emptyRating(response.responseId)} onChange={(next) => setRatings((r) => ({ ...r, [next.responseId]: next }))} />
                        </ResponseCard>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4 border-t border-foreground pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={caseIndex === 0} onClick={() => goTo(caseIndex - 1)}>
                      <ChevronLeft aria-hidden /> Previous question
                    </Button>
                    <Button variant="outline" disabled={caseIndex === SAMPLE_CASES.length - 1} onClick={() => goTo(caseIndex + 1)}>
                      Next question <ChevronRight aria-hidden />
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {scoredCount} of {responseIds.length} testimonies scored
                    </span>
                    <Button onClick={() => setRevealed(true)}>Unseal the record</Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-10">
                <section aria-labelledby="sample-mapping">
                  <h2 id="sample-mapping" className="mb-3 font-heading text-xl font-bold">
                    Who gave which testimony
                  </h2>
                  <div className="overflow-hidden rounded-[2px] bg-white ring-1 ring-exhibit-edge">
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
                  <h2 id="sample-scores" className="mb-3 font-heading text-xl font-bold">
                    Your practice findings
                  </h2>
                  {practice?.byConfiguration ? (
                    <div className="overflow-hidden rounded-[2px] bg-white ring-1 ring-exhibit-edge">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>1 juror × 5 questions (practice)</TableHead>
                            {SAMPLE_CONFIGURATIONS.map((c) => (
                              <TableHead key={c.key} className="text-right">
                                {c.label}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {DIMENSIONS.map((d) => (
                            <TableRow key={d}>
                              <TableCell>{RUBRIC[d].label}</TableCell>
                              {SAMPLE_CONFIGURATIONS.map((c) => (
                                <TableCell key={c.key} className="text-right tabular-nums">
                                  {formatScore(practice.byConfiguration![c.key].dimensions[d].mean)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                          <TableRow className="bg-slip font-semibold hover:bg-slip">
                            <TableCell>Overall mean</TableCell>
                            {SAMPLE_CONFIGURATIONS.map((c) => (
                              <TableCell key={c.key} className="text-right tabular-nums">
                                {formatScore(practice.byConfiguration![c.key].overallMean)}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="rounded-[2px] bg-slip px-5 py-4 text-sm leading-relaxed text-muted-foreground">
                      Score every testimony on all three lines (with a note for any 0) to see practice findings. In a real hearing, findings appear only for filed worksheets.
                    </p>
                  )}
                </section>

                <section aria-labelledby="sample-verdict" className="relative rounded-[2px] bg-white px-6 pt-6 pb-8 ring-1 ring-exhibit-edge sm:px-8">
                  <h2 id="sample-verdict" className="court-label">
                    Example judgment
                  </h2>
                  <p className="mt-3 font-heading text-2xl leading-snug font-bold">{SAMPLE_VERDICT.outcome}</p>
                  <p className="mt-3 max-w-3xl font-heading leading-relaxed">{SAMPLE_VERDICT.rationale}</p>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">Limitations: {SAMPLE_VERDICT.limitations}</p>
                  <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
                    <div className="min-w-56">
                      <div className="border-b border-foreground pb-1 font-heading text-xl italic">The judge</div>
                      <div className="mt-1 text-xs text-muted-foreground">Signature · practice only</div>
                    </div>
                    <Stamp kind="entered" detail="ILLUSTRATIVE" />
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
      </main>
    </div>
  )
}
