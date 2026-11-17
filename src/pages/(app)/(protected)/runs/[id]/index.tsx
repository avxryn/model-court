import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronRight, Copy, Link2, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { ERROR_TEXT, ErrorPanel, formatDuration, formatTime, Page, PageSkeleton, Plain, StaleNotice, StatusBadge } from '@/components/common'
import { Caption, DocketNumber, ExhibitSticker, Sheet, Stamp } from '@/components/court/CaseFile'
import { HearingFolder, StageLine } from '@/components/court/HearingNav'
import { docketNumber, recordStamp } from '@/lib/court'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { partySource } from '@/lib/parties'
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
      {run.data.role === 'owner' ? <OwnerRun run={run.data} reload={run.reload} live={live} /> : <Navigate to={`/runs/${run.data.runId}/review`} replace />}
    </Page>
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

  const stamp = recordStamp(run.status)
  const deliberating = run.status === 'reviewing' || run.status === 'revealed' || run.status === 'decided'
  return (
    <>
      <HearingFolder runId={run.runId} caseId={run.evaluationId} caseTitle={run.evaluationTitle} role="owner" status={run.status}>
      <Sheet>
      <Caption
        title={run.evaluationTitle}
        parties={run.configurations.map((c) => c.label)}
        details={
          <>
            <div>
              Case no. <DocketNumber>{docketNumber(run.evaluationId)}</DocketNumber>
            </div>
            <div>Hearing · {formatTime(run.createdAt)}</div>
            <StageLine status={run.status} />
            <div className="text-xs leading-snug text-muted-foreground">{run.comparisonMode === 'model' ? 'Model comparison: identical instructions, different models.' : 'Configuration comparison: instructions and models may differ; not an isolated model-quality test.'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-3 font-sans">
              <StatusBadge status={run.status} />
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={live ? 'Live updates connected' : 'Live updates reconnecting; refreshing every 15 seconds'}>
                {live ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
                {live ? 'Live' : 'Reconnecting'}
              </span>
            </div>
          </>
        }
        stamp={stamp && <Stamp kind={stamp} />}
      />

      <section aria-labelledby="progress-heading" className="space-y-4 border-t border-paper-rule px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="progress-heading" className="court-label">
            Hearing testimony <Plain>generating responses</Plain>
          </h2>
          <span className="text-sm tabular-nums text-muted-foreground" role="status">
            {terminal}/{run.counts.planned} finished · {run.counts.succeeded} succeeded · {run.counts.failed} failed · {run.counts.uncertain} uncertain
          </span>
        </div>
        <Collapsible collapsed={deliberating} summary="Show each question and party">
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
                      {partySource(c)}
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
                    if (!g) {
                      const imported = run.imported.some((i) => i.caseKey === testCase.key && i.configurationKey === c.key)
                      return <TableCell key={c.key} className="align-top text-sm text-muted-foreground">{imported ? 'Imported answer' : '—'}</TableCell>
                    }
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

        </Collapsible>
        {(run.status === 'generating' || run.status === 'ready') && (
          <div className="flex flex-wrap gap-2 border-t border-paper-rule pt-3">
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
              <AlertDialogTrigger render={<Button variant="ghost" disabled={busy} />}>Cancel hearing</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this hearing?</AlertDialogTitle>
                  <AlertDialogDescription>Queued requests are not sent. A request already in flight may still be charged; its output will be discarded. Successful responses stay in the record. You can start a new hearing afterward.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep going</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void act(() => api('POST', `/runs/${run.runId}/cancel`, { body: {}, revision: run.revision }), 'Hearing canceled')}>
                    Cancel hearing
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </section>

      {(run.status === 'reviewing' || run.status === 'revealed' || run.status === 'decided') && <ReviewPanel run={run} busy={busy} act={act} />}
      </Sheet>
      </HearingFolder>
    </>
  )
}

type Act = (fn: () => Promise<unknown>, success: string) => Promise<void>

function OpenReviewButton({ run, busy, act }: { run: OwnerRunView; busy: boolean; act: Act }) {
  const [ack, setAck] = useState(false)
  const eligible = run.eligibility.caseKeys.length
  const excluded = run.eligibility.excludedCaseKeys.length
  if (eligible === 0) {
    return <p className="self-center text-sm text-destructive">No question has testimony from both parties, so there is nothing comparable to review. Retry failures or cancel.</p>
  }
  return (
    <AlertDialog onOpenChange={() => setAck(false)}>
      <AlertDialogTrigger render={<Button disabled={busy} />}>Open deliberation</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open blind review?</AlertDialogTitle>
          <AlertDialogDescription>
            {eligible} question{eligible === 1 ? '' : 's'} will be reviewed. The testimony is frozen: no more retries or replacements in this hearing. Next, summon jurors and do your own review.
            {eligible === 1 && ' With one question, treat any conclusion as exploratory.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {excluded > 0 && (
          <div className="flex items-start gap-2 text-sm">
            <Checkbox id="ack-excluded" checked={ack} onCheckedChange={(c) => setAck(c === true)} />
            <Label htmlFor="ack-excluded" className="font-normal leading-snug">
              Exclude {excluded} incomplete question{excluded === 1 ? '' : 's'}. Their failures still count in the reliability statistics.
            </Label>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction disabled={excluded > 0 && !ack} onClick={() => void act(() => api('POST', `/runs/${run.runId}/open-review`, { body: { acknowledgeExcludedCases: excluded > 0 }, revision: run.revision }), 'Deliberation opened')}>
            Open deliberation
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
    <section aria-labelledby="review-heading" className="space-y-4 border-t border-paper-rule px-5 pt-6 pb-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="review-heading" className="court-label">
          The jury <Plain>blind review</Plain>
        </h2>
        <span className="text-sm tabular-nums text-muted-foreground" role="status">
          {run.review.submittedCount} filed · {run.review.pendingCount} unfinished (worksheets in progress and unused summonses)
        </span>
      </div>
      <ul className="divide-y divide-paper-rule exhibit-panel">
        {run.review.participants.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span>
              {p.label}
              {p.guest && (
                <span className="ml-2 text-muted-foreground">
                  · {p.guest.name} <ExhibitSticker className="px-1.5 py-0 text-[0.6875rem]">GUEST</ExhibitSticker> · {p.guest.devices} device{p.guest.devices === 1 ? '' : 's'}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge status={p.status} />
              {p.guest && p.guest.devices > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger render={<Button size="xs" variant="ghost" />}>Sign out devices</AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Sign {p.guest.name} out of every device?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {p.guest.devices} browser{p.guest.devices === 1 ? '' : 's'} lose access to this hearing at once. Their saved ratings stay. They can come back only with a resume link they saved; otherwise they cannot rejoin this seat.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep them signed in</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void act(() => api('POST', `/runs/${run.runId}/reviewers/${p.id}/sign-out-devices`, { body: {} }), 'Devices signed out')}>Sign out devices</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
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
              <span>Jury summons · expires {formatTime(invite.expiresAt)}</span>
              <span className="flex items-center gap-2">
                <StatusBadge status={invite.state} />
                {invite.state === 'unused' && reviewing && (
                  <Button size="xs" variant="ghost" onClick={() => void act(() => api('DELETE', `/runs/${run.runId}/invites/${invite.id}`), 'Summons revoked')}>
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
            <Link2 aria-hidden /> Summon a juror ({Math.max(slots, 0)} seats left)
          </Button>
          <RevealButton run={run} busy={busy} act={act} />
        </div>
      ) : (
        <Button render={<Link to={`/runs/${run.runId}/results`} />} nativeButton={false}>
          {run.status === 'decided' ? 'View the record and judgment' : 'View the record and enter judgment'}
        </Button>
      )}

      <Dialog open={inviteUrl !== null} onOpenChange={(open) => !open && setInviteUrl(null)}>
        <DialogContent className="border-t-4 border-dashed border-t-paper-edge sm:max-w-lg">
          <DialogHeader>
            <div className="typewriter text-xs font-bold text-stamp">JURY SUMMONS</div>
            <DialogTitle className="font-heading text-xl">You are summoned to serve as a juror</DialogTitle>
            <DialogDescription>
              Send this invitation link to one person. It works once, expires in 24 hours, and anyone holding it can take the seat, so share it directly. It is shown only once. Jurors need no API key.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={inviteUrl ?? ''} aria-label="Invitation link" className="typewriter bg-white" onFocus={(e) => e.currentTarget.select()} />
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
  if (submittedCount === 0) return <span className="self-center text-xs text-muted-foreground">Unsealing needs at least one filed worksheet.</span>
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button disabled={busy} />}>Unseal the record</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close the jury and reveal the models?</AlertDialogTitle>
          <AlertDialogDescription>
            {submittedCount} filed worksheet{submittedCount === 1 ? '' : 's'} will be included. {pendingCount > 0 ? `${pendingCount} unfinished worksheet${pendingCount === 1 ? '' : 's'} or unused summons${pendingCount === 1 ? '' : 'es'} will be closed and excluded.` : 'No worksheets are unfinished.'} This can’t be undone; a new experiment needs a new hearing.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pendingCount > 0 && (
          <Alert>
            <AlertTitle>{pendingCount} pending</AlertTitle>
            <AlertDescription>If someone submits while you confirm, the count changes and you will be asked again.</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep the jury open</AlertDialogCancel>
          <AlertDialogAction onClick={() => void act(() => api('POST', `/runs/${run.runId}/reveal`, { body: { acknowledgePendingCount: pendingCount }, revision: run.revision, idempotencyKey: newIntentKey() }), 'Record unsealed')}>
            Unseal the record
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Shows its children, or folds them behind a summary line once they are history. */
function Collapsible({ collapsed, summary, children }: { collapsed: boolean; summary: string; children: React.ReactNode }) {
  if (!collapsed) return <>{children}</>
  return (
    <details className="group">
      <summary className="inline-flex min-h-6 cursor-pointer items-center gap-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform duration-150 group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  )
}
