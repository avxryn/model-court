import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorPanel, Page, PageHeader, PageSkeleton, SaveIndicator, type SaveState } from '@/components/common'
import { CaseMaterial, ResponseCard } from '@/components/review/CaseEvidence'
import { emptyRating, RubricForm } from '@/components/review/RubricForm'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { DraftRating } from '@/domain/contracts'
import { DIMENSIONS, submissionIssues } from '@/domain/rubric'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { AnonymousReview } from '@/lib/dto'
import { useNoticeRefresh } from '@/lib/notices'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const AUTOSAVE_MS = 800

function isComplete(rating: DraftRating | undefined): boolean {
  return !!rating && DIMENSIONS.every((d) => rating[d] !== null)
}

export default function ReviewPage() {
  const { id = '' } = useParams()
  const resource = useApi<AnonymousReview>(`/runs/${id}/review`)
  const { data, error, loading, reload } = resource

  if (loading && !data) return <Page width="wide"><PageSkeleton label="Loading review" /></Page>
  if (error && !data) return <Page><ErrorPanel error={error} onRetry={reload} /></Page>
  if (!data) return null
  return <ReviewWorkspace key={data.sessionId} review={data} reload={reload} />
}

function ReviewWorkspace({ review, reload }: { review: AnonymousReview; reload: () => Promise<void> }) {
  const editable = review.sessionStatus === 'draft' && review.runStatus === 'reviewing'
  const [ratings, setRatings] = useState<Record<string, DraftRating>>(() => Object.fromEntries(review.ratings.map((r) => [r.responseId, r])))
  // The session revision is a ref: submit must use the value returned by the latest save.
  const revision = useRef(review.sessionRevision)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [dirty, setDirty] = useState(false)
  const [caseIndex, setCaseIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const saving = useRef<Promise<boolean> | null>(null)
  const submitKey = useRef<string>(newIntentKey())

  // A notice means something changed (e.g. reveal); refetch the authoritative review.
  useNoticeRefresh(review.runId, reload)

  const assigned = useMemo(() => review.cases.flatMap((c) => c.responses.map((r) => r.responseId)), [review.cases])
  const ratingList = useMemo(() => assigned.filter((id) => ratings[id]).map((id) => ratings[id]), [assigned, ratings])
  const issues = useMemo(() => submissionIssues(assigned, ratingList), [assigned, ratingList])

  const save = useCallback(async (): Promise<boolean> => {
    if (!editable) return true
    if (saving.current) await saving.current
    const run = (async () => {
      setSaveState('saving')
      try {
        const result = await api<{ sessionRevision: number }>('PUT', `/runs/${review.runId}/review`, { body: { ratings: ratingList }, revision: revision.current })
        revision.current = result.sessionRevision
        setDirty(false)
        setSaveState('saved')
        return true
      } catch (caught) {
        setSaveState(caught instanceof ApiClientError && caught.code === 'REVISION_CONFLICT' ? 'conflict' : 'error')
        return false
      } finally {
        saving.current = null
      }
    })()
    saving.current = run
    return run
  }, [editable, ratingList, review.runId])

  useEffect(() => {
    if (!dirty || saveState === 'conflict') return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS)
    return () => window.clearTimeout(timer.current)
  }, [dirty, save, saveState])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (next: DraftRating) => {
    setRatings((current) => ({ ...current, [next.responseId]: next }))
    setDirty(true)
    if (saveState !== 'conflict') setSaveState('idle')
  }

  const goTo = async (index: number) => {
    if (dirty) await save()
    setCaseIndex(index)
    window.scrollTo({ top: 0 })
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      if (saving.current) await saving.current
      if (dirty && !(await save())) throw new ApiClientError(409, 'NOT_SAVED', 'Your latest ratings could not be saved yet, so nothing was submitted.')
      await api('POST', `/runs/${review.runId}/review/submit`, { body: {}, revision: revision.current, idempotencyKey: submitKey.current })
      toast.success('Review submitted')
      await reload()
    } catch (caught) {
      toast.error(describeError(caught))
      submitKey.current = newIntentKey()
    } finally {
      setSubmitting(false)
    }
  }

  const current = review.cases[caseIndex]
  const caseDone = (index: number) => review.cases[index].responses.every((r) => isComplete(ratings[r.responseId]))

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={review.contextType === 'owner' ? 'Your review · judge, context-aware' : 'Blind review'}
        title="Review responses"
        description="Score each anonymous response against the reference and scoring guide. Labels are shuffled per case and per person."
        actions={editable && <SaveIndicator state={saveState} onRetry={() => void save()} />}
      />

      {review.closedNotice && (
        <Alert className="mb-6">
          <Info aria-hidden />
          <AlertTitle>Review closed</AlertTitle>
          <AlertDescription>{review.closedNotice}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" render={<Link to={`/runs/${review.runId}/results`} />} nativeButton={false}>
              View results
            </Button>
          </AlertAction>
        </Alert>
      )}
      {review.sessionStatus === 'submitted' && (
        <Alert className="mb-6">
          <CheckCircle2 aria-hidden />
          <AlertTitle>Submitted</AlertTitle>
          <AlertDescription>Your ratings are final. Results appear when the judge reveals the models.</AlertDescription>
        </Alert>
      )}
      {review.contextType === 'owner' && editable && (
        <Alert className="mb-6">
          <Info aria-hidden />
          <AlertTitle>You know which configurations you chose</AlertTitle>
          <AlertDescription>As judge, your review is reported separately as context-aware, never as part of the jury’s findings.</AlertDescription>
        </Alert>
      )}
      {saveState === 'conflict' && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>These ratings changed in another tab</AlertTitle>
          <AlertDescription>Your unsaved edits are still shown here. Reload to use the saved version (your local edits will be discarded).</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void reload()}>
              Reload saved version
            </Button>
          </AlertAction>
        </Alert>
      )}

      <nav aria-label="Cases" className="mb-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-secondary p-1 ring-1 ring-foreground/5">
          {review.cases.map((c, index) => (
            <Button
              key={c.caseKey}
              size="sm"
              variant="ghost"
              className={cn('h-8 px-3', index === caseIndex ? 'bg-card text-foreground shadow-xs ring-1 ring-foreground/10 hover:bg-card' : 'text-muted-foreground hover:bg-card/60')}
              aria-current={index === caseIndex ? 'step' : undefined}
              onClick={() => void goTo(index)}
            >
              {caseDone(index) && <CheckCircle2 aria-label="complete" className="text-success" />}
              Case {index + 1}
            </Button>
          ))}
        </div>
        {review.cases.length === 1 && <span className="self-center text-xs text-muted-foreground">Only one case was eligible — treat conclusions as exploratory.</span>}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <CaseMaterial title={current.title} input={current.input} reference={current.reference} expectedBehavior={current.expectedBehavior} />
        </div>
        <div className={cn('grid gap-6', current.responses.length > 1 && 'xl:grid-cols-2')}>
          {current.responses.map((response) => (
            <ResponseCard key={response.responseId} label={response.label} text={response.text}>
              <RubricForm label={response.label} rating={ratings[response.responseId] ?? emptyRating(response.responseId)} onChange={update} disabled={!editable} />
            </ResponseCard>
          ))}
        </div>
      </div>

      <div className="mt-10 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <Button variant="outline" disabled={caseIndex === 0} onClick={() => void goTo(caseIndex - 1)}>
            <ChevronLeft aria-hidden /> Previous case
          </Button>
          <Button variant="outline" disabled={caseIndex === review.cases.length - 1} onClick={() => void goTo(caseIndex + 1)}>
            Next case <ChevronRight aria-hidden />
          </Button>
        </div>
        {editable && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button disabled={issues.length > 0 || submitting} />}>Submit review</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Submit your review?</AlertDialogTitle>
                <AlertDialogDescription>Submitted ratings cannot be edited. They stay hidden from everyone else until the judge reveals the models.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                <AlertDialogAction onClick={() => void submit()}>Submit review</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {editable && issues.length > 0 && (
        <p className="mt-2 text-right text-xs text-muted-foreground" role="status">
          {issues.length} item{issues.length === 1 ? '' : 's'} left: score every response on all three dimensions, with a note for any 0.
        </p>
      )}
    </Page>
  )
}
