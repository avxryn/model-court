/**
 * Public, keyless sample (F19). Static tier: no auth fetch, no WebSocket, no
 * provider or API requests. Practice ratings live only in this page's memory.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, FlaskConical, RotateCcw } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { Page, PageHeader, SectionHeading } from '@/components/common'
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <BrandMark />
          </Link>
          <Button size="sm" variant="outline" render={<Link to="/evaluations" />} nativeButton={false}>
            Create your own
          </Button>
        </div>
      </header>
      <main id="main">
        <Page width="wide">
          <PageHeader
            eyebrow="Sample evaluation"
            title="Support policy answers"
            description="Practice the workflow: score two anonymous responses per case, then reveal which configuration wrote which."
            actions={
              <Button variant="ghost" onClick={reset}>
                <RotateCcw aria-hidden /> Reset sample
              </Button>
            }
          />
          <Alert className="mb-8">
            <FlaskConical aria-hidden />
            <AlertTitle>Illustrative sample</AlertTitle>
            <AlertDescription>
              {SAMPLE_PROVENANCE} Your practice ratings stay in this browser tab and are never saved as evidence.
            </AlertDescription>
          </Alert>

          {!revealed ? (
            <>
              <nav aria-label="Cases" className="mb-6 inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-secondary p-1 ring-1 ring-foreground/5">
                {SAMPLE_CASES.map((c, index) => (
                  <Button
                    key={c.key}
                    size="sm"
                    variant="ghost"
                    className={cn('h-8 px-3', index === caseIndex ? 'bg-card text-foreground shadow-xs ring-1 ring-foreground/10 hover:bg-card' : 'text-muted-foreground hover:bg-card/60')}
                    aria-current={index === caseIndex ? 'step' : undefined}
                    onClick={() => setCaseIndex(index)}
                  >
                    {caseScored(index) && <CheckCircle2 aria-hidden className="text-success" />}
                    Case {index + 1}
                  </Button>
                ))}
              </nav>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div className="lg:sticky lg:top-4 lg:self-start">
                  <CaseMaterial title={current.title} input={current.input} reference={current.reference} expectedBehavior={current.expectedBehavior} />
                </div>
                <div className="grid gap-6 xl:grid-cols-2">
                  {current.responses.map((response) => (
                    <ResponseCard key={response.responseId} label={response.label} text={response.text}>
                      <RubricForm label={response.label} rating={ratings[response.responseId] ?? emptyRating(response.responseId)} onChange={(next) => setRatings((r) => ({ ...r, [next.responseId]: next }))} />
                    </ResponseCard>
                  ))}
                </div>
              </div>
              <div className="mt-10 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  <Button variant="outline" disabled={caseIndex === 0} onClick={() => setCaseIndex((i) => i - 1)}>
                    Previous case
                  </Button>
                  <Button variant="outline" disabled={caseIndex === SAMPLE_CASES.length - 1} onClick={() => setCaseIndex((i) => i + 1)}>
                    Next case
                  </Button>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {scoredCount} of {responseIds.length} responses scored
                  </span>
                  <Button onClick={() => setRevealed(true)}>Reveal configurations</Button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-12">
              <section aria-labelledby="sample-mapping">
                <SectionHeading id="sample-mapping">Who wrote what</SectionHeading>
                <div className="surface overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Case</TableHead>
                        <TableHead>Response A</TableHead>
                        <TableHead>Response B</TableHead>
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
                <SectionHeading id="sample-scores">Your practice scores</SectionHeading>
                {practice?.byConfiguration ? (
                  <div className="surface overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>1 reviewer × 5 cases (practice)</TableHead>
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
                        <TableRow className="bg-secondary/40 font-semibold hover:bg-secondary/40">
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
                  <p className="rounded-xl bg-secondary/70 px-5 py-4 text-sm leading-relaxed text-muted-foreground">
                    Score every response on all three dimensions (with a note for any 0) to see practice scores. In a real run, scores appear only for submitted reviews.
                  </p>
                )}
              </section>

              <section aria-labelledby="sample-verdict" className="surface relative overflow-hidden p-6 pl-7 sm:p-8 sm:pl-9">
                <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brass" />
                <h2 id="sample-verdict" className="eyebrow font-sans">
                  Example verdict
                </h2>
                <p className="mt-3 font-heading text-2xl leading-snug font-semibold tracking-tight">{SAMPLE_VERDICT.outcome}</p>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed">{SAMPLE_VERDICT.rationale}</p>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">Limitations: {SAMPLE_VERDICT.limitations}</p>
              </section>

              <div className="flex flex-wrap gap-3">
                <Button render={<Link to="/evaluations" />} nativeButton={false}>
                  Run this with your own keys
                </Button>
                <Button variant="outline" onClick={reset}>
                  Start the sample over
                </Button>
              </div>
            </div>
          )}
        </Page>
      </main>
    </div>
  )
}
