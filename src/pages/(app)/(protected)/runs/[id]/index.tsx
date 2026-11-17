import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Copy, Link2, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { ERROR_TEXT, ErrorPanel, formatDuration, formatTime, Page, PageHeader, PageSkeleton, StaleNotice, StatusBadge } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PROVIDER_NAMES } from '@/domain/registry'
import { api, describeError, newIntentKey } from '@/lib/api-client'
import type { OwnerRunView, RunView } from '@/lib/dto'
import { useNoticeRefresh } from '@/lib/notices'
import { useApi } from '@/lib/use-api'

export default function RunPage() {
  const { id = '' } = useParams()
  // 15s authorized reconciliation only while work is active (spec §10.1, notice loss).
  const [active, setActive] = useState(true)
  const run = useApi<RunView>(`/runs/${id}`, { pollMs: active ? 15_000 : undefined })
  const { reload } = run
  const refresh = useCallback(() => void reload(), [reload])
  const { live } = useNoticeRefresh(id, refresh)
  const status = run.data?.status
  useEffect(() => {
    if (status) setActive(['generating', 'ready', 'reviewing'].includes(status))
  }, [status])

  if (run.loading && !run.data) return <Page width="wide"><PageSkeleton label="Loading run" /></Page>
  if (run.error && !run.data) return <Page><ErrorPanel error={run.error} onRetry={run.reload} /></Page>
  if (!run.data) return null
  return (
    <Page width="wide">
      {run.stale && <StaleNotice onRetry={run.reload} />}
      {run.data.role === 'owner' ? <OwnerRun run={run.data} reload={run.reload} live={live} /> : <ReviewerRun run={run.data} />}
    </Page>
  )
}

function ReviewerRun({ run }: { run: Extract<RunView, { role: 'reviewer' }> }) {
  const revealed = run.status === 'revealed' || run.status === 'decided'
  return (
    <>
      <PageHeader eyebrow="Invited review" title={run.evaluationTitle} actions={<StatusBadge status={run.status} />} />
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{revealed ? 'The judge has revealed the models. Results include the jury’s findings.' : 'Score the anonymous responses. Other jurors cannot see your ratings, and you cannot see theirs, until the judge reveals the models.'}</p>
      <div className="mt-6 flex gap-2">
        <Button render={<Link to={`/runs/${run.runId}/review`} />} nativeButton={false} variant={revealed ? 'outline' : 'default'}>
          {run.session?.status === 'draft' && !revealed ? 'Continue review' : 'View my review'}
        </Button>
        {revealed && (
          <Button render={<Link to={`/runs/${run.runId}/results`} />} nativeButton={false}>
            View results
          </Button>
        )}
      </div>
    </>
  )
}

function OwnerRun({ run, reload, live }: { run: OwnerRunView; reload: () => Promise<void>; live: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const terminal = run.counts.succeeded + run.counts.failed + run.counts.uncertain + run.counts.canceled
  const configByKey = Object.fromEntries(run.configurations.map((c) => [c.key, c]))
  const retryable = run.generations.filter((g) => g.retryable)
  const selectedUncertain = run.generations.filter((g) => selected.has(g.id) && g.status === 'uncertain').length

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(success)
      setSelected(new Set())
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
      await reload()
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to={`/evaluations/${run.evaluationId}`} className="hover:underline">
            {run.evaluationTitle}
          </Link>
        }
        title={`Run · ${formatTime(run.createdAt)}`}
        description={run.comparisonMode === 'model' ? 'Model comparison: identical instructions, different models.' : 'Configuration comparison: instructions and models may differ; not an isolated model-quality test.'}
        actions={
          <>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={live ? 'Live updates connected' : 'Live updates reconnecting; refreshing every 15 seconds'}>
              {live ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
              {live ? 'Live' : 'Reconnecting'}
            </span>
            <StatusBadge status={run.status} />
          </>
        }
      />

      <section aria-labelledby="progress-heading" className="surface space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="progress-heading" className="text-lg font-semibold">
            Generation
          </h2>
          <span className="text-sm tabular-nums text-muted-foreground" role="status">
            {terminal}/{run.counts.planned} finished · {run.counts.succeeded} succeeded · {run.counts.failed} failed · {run.counts.uncertain} uncertain
          </span>
        </div>
        <Progress value={(terminal / Math.max(run.counts.planned, 1)) * 100} aria-label="Generation progress" />
        {run.status === 'generating' && <p className="text-xs text-muted-foreground">Jobs run one at a time and survive closing this page. Each request has a 90-second deadline; there are no automatic paid retries.</p>}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                {run.configurations.map((c) => (
                  <TableHead key={c.key} className="h-auto py-2.5 text-sm text-foreground">
                    {c.label}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {PROVIDER_NAMES[c.provider]} · {c.modelId}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.cases.map((testCase) => (
                <TableRow key={testCase.key}>
                  <TableCell className="font-medium">
                    {testCase.title}
                    {run.eligibility.excludedCaseKeys.includes(testCase.key) && run.status !== 'generating' && <span className="block text-xs font-normal text-warning">Not comparable (excluded)</span>}
                  </TableCell>
                  {run.configurations.map((c) => {
                    const g = run.generations.find((x) => x.caseKey === testCase.key && x.configurationKey === c.key)
                    if (!g) return <TableCell key={c.key}>—</TableCell>
                    return (
                      <TableCell key={c.key} className="align-top">
                        <div className="flex items-center gap-2">
                          {g.retryable && (
                            <Checkbox
                              aria-label={`Select ${testCase.title} / ${configByKey[c.key]?.label} for retry`}
                              checked={selected.has(g.id)}
                              onCheckedChange={(checked) => setSelected((s) => {
                                const next = new Set(s)
                                if (checked) next.add(g.id)
                                else next.delete(g.id)
                                return next
                              })}
                            />
                          )}
                          <StatusBadge status={g.status} />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                          Attempt {g.attemptCount}/2 · {formatDuration(g.durationMs)}
                        </div>
                        {g.errorCode && <div className="mt-1 max-w-56 text-xs text-destructive">{ERROR_TEXT[g.errorCode] ?? g.errorCode}</div>}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {(run.status === 'generating' || run.status === 'ready') && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {retryable.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="outline" disabled={selected.size === 0 || busy} />}>
                  <RefreshCw aria-hidden /> Retry selected ({selected.size})
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Retry {selected.size} generation{selected.size === 1 ? '' : 's'}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Each retry is a new paid request to your provider account and the last allowed attempt.
                      {selectedUncertain > 0 && ` ${selectedUncertain} selected generation${selectedUncertain === 1 ? ' has' : 's have'} an uncertain outcome: the provider may already have charged for the earlier attempt.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void act(() => api('POST', `/runs/${run.runId}/retries`, { body: { generationIds: [...selected], acknowledgePossiblePriorCharge: true }, revision: run.revision, idempotencyKey: newIntentKey() }), 'Retry queued')
                      }
                    >
                      Retry and charge my account
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {run.status === 'ready' && <OpenReviewButton run={run} busy={busy} act={act} />}
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" disabled={busy} />}>Cancel run</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
                  <AlertDialogDescription>Queued requests are not sent. A request already in flight may still be charged; its output will be discarded. Successful responses stay in the record. You can start a new run afterward.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep running</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void act(() => api('POST', `/runs/${run.runId}/cancel`, { body: {}, revision: run.revision }), 'Run canceled')}>
                    Cancel run
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </section>

      {(run.status === 'reviewing' || run.status === 'revealed' || run.status === 'decided') && <ReviewPanel run={run} busy={busy} act={act} />}
    </>
  )
}

type Act = (fn: () => Promise<unknown>, success: string) => Promise<void>

function OpenReviewButton({ run, busy, act }: { run: OwnerRunView; busy: boolean; act: Act }) {
  const [ack, setAck] = useState(false)
  const eligible = run.eligibility.caseKeys.length
  const excluded = run.eligibility.excludedCaseKeys.length
  if (eligible === 0) {
    return <p className="self-center text-sm text-destructive">No case has a successful response from both configurations, so there is nothing comparable to review. Retry failures or cancel.</p>
  }
  return (
    <AlertDialog onOpenChange={() => setAck(false)}>
      <AlertDialogTrigger render={<Button disabled={busy} />}>Open review</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open blind review?</AlertDialogTitle>
          <AlertDialogDescription>
            {eligible} case{eligible === 1 ? '' : 's'} will be reviewed. Accepted responses are frozen: no more retries or replacements in this run.
            {eligible === 1 && ' With one case, treat any conclusion as exploratory.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {excluded > 0 && (
          <div className="flex items-start gap-2 text-sm">
            <Checkbox id="ack-excluded" checked={ack} onCheckedChange={(c) => setAck(c === true)} />
            <Label htmlFor="ack-excluded" className="font-normal leading-snug">
              Exclude {excluded} incomplete case{excluded === 1 ? '' : 's'}. Their failures still count in the reliability statistics.
            </Label>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction disabled={excluded > 0 && !ack} onClick={() => void act(() => api('POST', `/runs/${run.runId}/open-review`, { body: { acknowledgeExcludedCases: excluded > 0 }, revision: run.revision }), 'Review opened')}>
            Open review
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ReviewPanel({ run, busy, act }: { run: OwnerRunView; busy: boolean; act: Act }) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const inviteKey = useRef(newIntentKey())
  const reviewing = run.status === 'reviewing'
  const ownerSession = run.review.participants.find((p) => p.contextType === 'owner')
  const unusedInvites = run.review.invites.filter((i) => i.state === 'unused').length
  const slots = 3 - run.review.participants.filter((p) => p.contextType === 'invited' && p.status !== 'revoked').length - unusedInvites

  const createInvite = async () => {
    try {
      const result = await api<{ url: string | null; requiresReissue: boolean }>('POST', `/runs/${run.runId}/invites`, { body: {}, idempotencyKey: inviteKey.current })
      inviteKey.current = newIntentKey()
      if (!result.url) {
        toast.error('That invitation link can no longer be shown. Revoke the unused invitation and create a new one.')
      } else setInviteUrl(result.url)
    } catch (caught) {
      toast.error(describeError(caught))
    }
  }

  return (
    <section aria-labelledby="review-heading" className="surface mt-6 space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="review-heading" className="text-lg font-semibold">
          Blind review
        </h2>
        <span className="text-sm tabular-nums text-muted-foreground" role="status">
          {run.review.submittedCount} submitted · {run.review.pendingCount} unfinished (drafts and unused invitations)
        </span>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {run.review.participants.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span>{p.label}</span>
            <span className="flex items-center gap-2">
              <StatusBadge status={p.status} />
              {reviewing && p.contextType === 'invited' && p.status === 'draft' && (
                <Button size="xs" variant="ghost" onClick={() => void act(() => api('DELETE', `/runs/${run.runId}/reviewers/${p.id}`), 'Juror removed')}>
                  Remove
                </Button>
              )}
            </span>
          </li>
        ))}
        {run.review.invites
          .filter((i) => i.state !== 'redeemed')
          .map((invite) => (
            <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-muted-foreground">
              <span>Invitation · expires {formatTime(invite.expiresAt)}</span>
              <span className="flex items-center gap-2">
                <StatusBadge status={invite.state} />
                {invite.state === 'unused' && reviewing && (
                  <Button size="xs" variant="ghost" onClick={() => void act(() => api('DELETE', `/runs/${run.runId}/invites/${invite.id}`), 'Invitation revoked')}>
                    Revoke
                  </Button>
                )}
              </span>
            </li>
          ))}
      </ul>

      {reviewing ? (
        <div className="flex flex-wrap gap-2">
          {ownerSession && (
            <Button variant="outline" render={<Link to={`/runs/${run.runId}/review`} />} nativeButton={false}>
              {ownerSession.status === 'submitted' ? 'View your review' : 'Do your own review'}
            </Button>
          )}
          <Button variant="outline" disabled={slots <= 0 || busy} onClick={() => void createInvite()}>
            <Link2 aria-hidden /> Invite a juror ({Math.max(slots, 0)} left)
          </Button>
          <RevealButton run={run} busy={busy} act={act} />
        </div>
      ) : (
        <Button render={<Link to={`/runs/${run.runId}/results`} />} nativeButton={false}>
          View results and verdict
        </Button>
      )}

      <Dialog open={inviteUrl !== null} onOpenChange={(open) => !open && setInviteUrl(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Invitation link</DialogTitle>
            <DialogDescription>Single use, expires in 24 hours. Anyone with this link can claim the juror seat, so share it directly. It is shown only once.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={inviteUrl ?? ''} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(inviteUrl ?? '').then(
                  () => toast.success('Link copied'),
                  () => toast.error('Copy failed — select the link and copy it manually.'),
                )
              }}
            >
              <Copy aria-hidden /> Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function RevealButton({ run, busy, act }: { run: OwnerRunView; busy: boolean; act: Act }) {
  const { submittedCount, pendingCount } = run.review
  if (submittedCount === 0) return <span className="self-center text-xs text-muted-foreground">Reveal needs at least one submitted review.</span>
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button disabled={busy} />}>Reveal models</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close review and reveal?</AlertDialogTitle>
          <AlertDialogDescription>
            {submittedCount} submitted review{submittedCount === 1 ? '' : 's'} will be included. {pendingCount > 0 ? `${pendingCount} unfinished review${pendingCount === 1 ? '' : 's'} or unused invitation${pendingCount === 1 ? '' : 's'} will be closed and excluded.` : 'No reviews are unfinished.'} This cannot be undone; a new experiment needs a new run.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pendingCount > 0 && (
          <Alert>
            <AlertTitle>{pendingCount} pending</AlertTitle>
            <AlertDescription>If someone submits while you confirm, the count changes and you will be asked again.</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep reviewing open</AlertDialogCancel>
          <AlertDialogAction onClick={() => void act(() => api('POST', `/runs/${run.runId}/reveal`, { body: { acknowledgePendingCount: pendingCount }, revision: run.revision, idempotencyKey: newIntentKey() }), 'Models revealed')}>
            Reveal models
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
