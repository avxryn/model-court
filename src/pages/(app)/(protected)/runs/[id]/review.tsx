/**
 * The worksheet (B divider for the judge, A for jurors): score each
 * anonymous testimony against the exhibit and the jury instructions.
 */

import { useCallback, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Info } from 'lucide-react'
import { Sheet, Stamp, Term } from '@/components/court/CaseFile'
import { HearingFolder } from '@/components/court/HearingNav'
import { Plain } from '@/components/court/Paper'
import { ErrorPanel } from '@/components/feedback/ErrorPanel'
import { PageSkeleton } from '@/components/feedback/PageSkeleton'
import { SaveIndicator } from '@/components/feedback/SaveIndicator'
import { UnsealButton } from '@/components/hearing/JuryPanel'
import { useHearingAction } from '@/components/hearing/use-hearing-action'
import { Page } from '@/components/layout/Page'
import { CaseMaterial, ResponseCard } from '@/components/review/CaseEvidence'
import { CitedTestimony } from '@/components/review/CitedTestimony'
import { ExtractionTestimony } from '@/components/review/ExtractionTestimony'
import { ToolTraceView } from '@/components/review/ToolTrace'
import { PdfViewer } from '@/components/review/PdfViewer'
import { emptyRating, RubricForm } from '@/components/review/RubricForm'
import { isComplete, useWorksheet } from '@/components/review/use-worksheet'
import { QuestionPager, QuestionStepper, useWorksheetKeys, WorksheetGrid, WorksheetKeyLegend } from '@/components/review/Worksheet'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { AnonymousReview, OwnerRunView, RunView } from '@/lib/dto'
import { plural } from '@/lib/format'
import { useNoticeRefresh } from '@/lib/notices'
import { isUnsealed } from '@/lib/status'
import { useApi } from '@/lib/use-api'

export default function ReviewPage() {
  const { id = '' } = useParams()
  const guest = useLocation().pathname.startsWith('/juror/')
  // Guests (D-41) have no live socket: refresh every 20 seconds instead.
  const resource = useApi<AnonymousReview>(`/runs/${id}/review`, { pollMs: guest ? 20_000 : undefined })
  const { data, error, loading, reload } = resource

  if (loading && !data) return <Page width="wide"><PageSkeleton variant="sheet" label="Loading the worksheet" /></Page>
  if (error && !data) return <Page><ErrorPanel error={error} onRetry={reload} /></Page>
  if (!data) return null
  return <ReviewWorkspace key={data.sessionId} review={data} reload={reload} />
}

function ReviewWorkspace({ review, reload }: { review: AnonymousReview; reload: () => Promise<void> }) {
  const recordBase = useLocation().pathname.startsWith('/juror/') ? `/juror/${review.runId}` : `/runs/${review.runId}`
  const navigate = useNavigate()
  const isOwner = review.contextType === 'owner'
  // The judge also needs the hearing: whether a jury exists, and what unsealing would close.
  const hearingResource = useApi<RunView>(isOwner ? `/runs/${review.runId}` : null)
  const reloadHearing = hearingResource.reload
  const hearing = hearingResource.data?.role === 'owner' ? hearingResource.data : null
  const refreshAll = useCallback(async () => {
    await Promise.all([reload(), reloadHearing()])
  }, [reload, reloadHearing])
  const w = useWorksheet(review, refreshAll)
  const { busy, act } = useHearingAction(refreshAll)
  const [caseIndex, setCaseIndex] = useState(0)
  // A notice means something changed (e.g. reveal); refetch the authoritative review.
  useNoticeRefresh(review.runId, refreshAll)

  const goTo = async (index: number) => {
    await w.flush()
    setCaseIndex(index)
    window.scrollTo({ top: 0 })
  }
  useWorksheetKeys({
    onNextQuestion: caseIndex < review.cases.length - 1 ? () => goTo(caseIndex + 1) : undefined,
    onPreviousQuestion: caseIndex > 0 ? () => goTo(caseIndex - 1) : undefined,
  })
  const current = review.cases[caseIndex]
  const filed = review.sessionStatus === 'submitted'
  const solo = hearing !== null && hasNoJury(hearing)

  return (
    <Page width="wide">
      <HearingFolder runId={review.runId} caseId={review.evaluationId} caseTitle={review.evaluationTitle} role={isOwner ? 'owner' : 'reviewer'} status={review.runStatus}>
        <Sheet>
          <div className="flex flex-col gap-4 border-b border-paper-rule px-5 pt-7 pb-6 sm:flex-row sm:items-start sm:justify-between sm:px-8">
            <div className="min-w-0 space-y-1.5">
              <div className="court-label">
                {isOwner ? (
                  <>
                    The judge’s own review <Plain>context-aware, reported separately</Plain>
                  </>
                ) : (
                  <Term name="worksheet" />
                )}
              </div>
              <h1 className="font-display text-2xl leading-tight font-medium tracking-tight sm:text-3xl">Score the testimony</h1>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Score each testimony against the exhibit and the jury instructions. Labels are shuffled for every question and every person.</p>
              {!isOwner && !filed && (
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  First time scoring?{' '}
                  <a href="/sample" target="_blank" rel="noopener" className="text-foreground underline underline-offset-4">
                    Practice on the sample case
                  </a>{' '}
                  (opens in a new tab, about two minutes; nothing you do there is saved or sent).
                </p>
              )}
              {isOwner && w.editable && (
                <p className="flex max-w-2xl items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0" /> You know which parties you chose, so your review is reported separately as context-aware, never as part of the jury’s findings.
                </p>
              )}
              {filed && (
                <p className="max-w-2xl text-sm leading-relaxed text-foreground" role="status">
                  Your ratings are final.{' '}
                  {isUnsealed(review.runStatus) ? (
                    <>
                      The record is unsealed:{' '}
                      <Link to={`${recordBase}/results`} className="underline underline-offset-4">
                        open the Record
                      </Link>
                      .
                    </>
                  ) : isOwner ? (
                    hearing ? (
                      <JudgeNextStep run={hearing} />
                    ) : null
                  ) : (
                    'The record opens when the judge unseals it.'
                  )}
                </p>
              )}
              {filed && isOwner && hearing && !isUnsealed(review.runStatus) && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <UnsealButton run={hearing} busy={busy} act={act} />
                  {hearing.review.pendingCount > 0 && (
                    <Button variant="outline" render={<Link to={`/runs/${review.runId}`} />} nativeButton={false}>
                      Follow the jury in Proceedings
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {w.editable && <SaveIndicator state={w.saveState} onRetry={() => void w.save()} />}
              {filed && <Stamp kind="filed" detail="FINDINGS ARE FINAL" />}
            </div>
          </div>

          <div className="space-y-6 px-5 pt-6 pb-10 sm:px-8">
            {review.closedNotice && (
              <Alert>
                <Info aria-hidden />
                <AlertTitle>The jury is closed</AlertTitle>
                <AlertDescription>{review.closedNotice}</AlertDescription>
                <AlertAction>
                  <Button size="sm" variant="outline" render={<Link to={`${recordBase}/results`} />} nativeButton={false}>
                    View the record
                  </Button>
                </AlertAction>
              </Alert>
            )}
            {w.saveState === 'conflict' && (
              <Alert variant="destructive">
                <AlertTitle>These ratings changed in another tab</AlertTitle>
                <AlertDescription>Your unsaved edits are still shown here. Reload to use the saved version (your local edits will be discarded).</AlertDescription>
                <AlertAction>
                  <Button size="sm" variant="outline" onClick={() => void reload()}>
                    Reload saved version
                  </Button>
                </AlertAction>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <QuestionPager count={review.cases.length} current={caseIndex} isDone={(index) => review.cases[index].responses.every((r) => isComplete(w.ratings[r.responseId]))} onSelect={(index) => void goTo(index)} />
              {review.cases.some((testCase) => testCase.document !== undefined) && <span className="text-xs text-muted-foreground">You’ll see the source documents for this case: the same file for every party.</span>}
              {review.cases.length === 1 && <span className="text-xs text-muted-foreground">Only one question was eligible — treat conclusions as exploratory.</span>}
              {w.editable && (
                <div className="ml-auto">
                  <WorksheetKeyLegend />
                </div>
              )}
            </div>

            <WorksheetGrid
              columns={current.responses.length}
              wideMaterial={current.document !== undefined}
              material={<CaseMaterial title={current.title} input={current.input} reference={current.reference} expectedBehavior={current.expectedBehavior} number={caseIndex + 1} total={review.cases.length} messages={current.messages} kitView={current.kitView} kitName={review.kit?.name} {...(current.document !== undefined ? { document: current.document } : {})} {...(current.sources !== undefined ? { sources: current.sources, caseKey: current.caseKey } : {})} pdf={current.document?.kind === 'pdf' ? <PdfViewer key={current.caseKey} runId={review.runId} caseKey={current.caseKey} pageCount={current.document.pageCount} /> : undefined} />}
            >
              {current.responses.map((response) => {
                const rating = w.ratings[response.responseId] ?? emptyRating(response.responseId)
                const form = <RubricForm label={response.label} rating={rating} onChange={w.update} disabled={!w.editable} rubricVersion={review.rubricVersion} />
                // Spec 04 (D-88): an extraction answer shows as fields with per-field flags.
                // Spec 06 (D-103): a tool-use answer shows as its trace; the same shape for every party.
                return response.trace ? (
                  <ToolTraceView key={response.responseId} label={response.label} trace={response.trace} maxSteps={current.kitView?.kind === 'tools' ? current.kitView.maxSteps : undefined}>
                    {form}
                  </ToolTraceView>
                ) : response.extraction ? (
                  <ExtractionTestimony key={response.responseId} label={response.label} text={response.text} extraction={response.extraction} flags={rating.fieldFlags ?? []} disabled={!w.editable} onFlagsChange={(fieldFlags) => w.update({ ...rating, fieldFlags })}>
                    {form}
                  </ExtractionTestimony>
                ) : current.sources !== undefined ? (
                  // Spec 05 (D-96): citations as chips, the same rendering for every party; no check result.
                  <CitedTestimony key={response.responseId} label={response.label} text={response.text} caseKey={current.caseKey} sources={current.sources}>
                    {form}
                  </CitedTestimony>
                ) : (
                  <ResponseCard key={response.responseId} label={response.label} text={response.text}>
                    {form}
                  </ResponseCard>
                )
              })}
            </WorksheetGrid>

            <QuestionStepper current={caseIndex} count={review.cases.length} onGo={(index) => void goTo(index)}>
              {w.editable && (
                <>
                  <span className="text-xs text-muted-foreground tabular-nums" role="status">
                    {w.scored < w.total ? `${w.scored} of ${w.total} testimonies scored` : w.issues.length > 0 ? 'Add a note to every 0 before filing' : `All ${w.total} testimonies scored`}
                  </span>
                  {isOwner && solo ? (
                    <FileAndUnseal
                      disabled={w.issues.length > 0 || w.submitting}
                      onConfirm={() =>
                        void w.submit({ unseal: true }).then((done) => {
                          if (done) navigate(`/runs/${review.runId}/results`)
                        })
                      }
                    />
                  ) : (
                    <FileFindings disabled={w.issues.length > 0 || w.submitting} onFile={() => void w.submit()} />
                  )}
                </>
              )}
            </QuestionStepper>
          </div>
        </Sheet>
      </HearingFolder>
    </Page>
  )
}

/** No juror seated or summoned: the judge's review is the whole record. The server checks this again. */
function hasNoJury(run: OwnerRunView): boolean {
  return !run.review.participants.some((p) => p.contextType === 'invited' && p.status !== 'revoked') && !run.review.invites.some((i) => i.state === 'unused')
}

/** After the judge files: what is left before the record can open. */
function JudgeNextStep({ run }: { run: OwnerRunView }) {
  const { pendingCount, submittedCount } = run.review
  if (pendingCount > 0) {
    return (
      <>
        {plural(pendingCount, 'juror worksheet or summons', 'juror worksheets or summonses')} still out. Unseal now to close them, or wait for the jury in Proceedings.
      </>
    )
  }
  return <>{submittedCount > 1 ? 'Every juror has filed. ' : ''}Unseal the record to see which party gave each answer.</>
}

/** A judge with no jury: one confirmation files the worksheet and unseals the record. */
function FileAndUnseal({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button disabled={disabled} />}>File and unseal</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>File your findings and unseal the record?</AlertDialogTitle>
          <AlertDialogDescription>No jurors were summoned, so your review is the whole record. Your ratings become final and the record shows which party gave each answer. This can’t be undone. To add jurors first, summon them from Proceedings.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep scoring</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>File and unseal</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function FileFindings({ disabled, onFile }: { disabled: boolean; onFile: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button disabled={disabled} />}>File findings</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>File your findings?</AlertDialogTitle>
          <AlertDialogDescription>Filed ratings can’t be edited. They stay hidden from everyone else until the judge unseals the record.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep deliberating</AlertDialogCancel>
          <AlertDialogAction onClick={onFile}>File findings</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
