/**
 * The jury during and after deliberation: every seat and summons with its
 * state, the judge's own review, summoning, and unsealing the record.
 */

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { ExhibitSticker } from '@/components/court/CaseFile'
import { Panel, Plain } from '@/components/court/Paper'
import type { Act } from '@/components/hearing/use-hearing-action'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, describeError, newIntentKey } from '@/lib/api-client'
import type { OwnerRunView } from '@/lib/dto'
import { formatTime, plural } from '@/lib/format'

type Participant = OwnerRunView['review']['participants'][number]

export function JuryPanel({ run, busy, act }: { run: OwnerRunView; busy: boolean; act: Act }) {
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
      if (!result.url) toast.error('That invitation link can no longer be shown. Revoke the unused invitation and create a new one.')
      else setInviteUrl(result.url)
    } catch (caught) {
      toast.error(describeError(caught))
    }
  }

  return (
    <section aria-labelledby="review-heading" className="space-y-4 border-t border-paper-rule px-5 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="review-heading" className="court-label">
          The jury <Plain>blind review</Plain>
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums" role="status">
          {run.review.submittedCount} filed · {run.review.pendingCount} unfinished (worksheets in progress and unused summonses)
        </span>
      </div>
      <Panel as="ul" className="divide-y divide-paper-rule">
        {run.review.participants.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span>
              {p.label}
              {p.guest && (
                <span className="ml-2 text-muted-foreground">
                  · {p.guest.name} <ExhibitSticker className="px-1.5 py-0 text-caption">GUEST</ExhibitSticker> · {plural(p.guest.devices, 'device')}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge status={p.status} />
              {p.guest && p.guest.devices > 0 && <SignOutDevices run={run} participant={p} act={act} />}
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
      </Panel>

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
          <UnsealButton run={run} busy={busy} act={act} />
        </div>
      ) : (
        <Button render={<Link to={`/runs/${run.runId}/${run.status === 'decided' ? 'results' : 'judgment'}`} />} nativeButton={false}>
          {run.status === 'decided' ? 'View the record and judgment' : 'Enter judgment'}
        </Button>
      )}

      <JurySummonsDialog url={inviteUrl} onClose={() => setInviteUrl(null)} />
    </section>
  )
}

function SignOutDevices({ run, participant, act }: { run: OwnerRunView; participant: Participant; act: Act }) {
  const guest = participant.guest
  if (!guest) return null
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button size="xs" variant="ghost" />}>Sign out devices</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign {guest.name} out of every device?</AlertDialogTitle>
          <AlertDialogDescription>{plural(guest.devices, 'browser')} lose access to this hearing at once. Their saved ratings stay. They can come back only with a resume link they saved; otherwise they cannot rejoin this seat.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep them signed in</AlertDialogCancel>
          <AlertDialogAction onClick={() => void act(() => api('POST', `/runs/${run.runId}/reviewers/${participant.id}/sign-out-devices`, { body: {} }), 'Devices signed out')}>Sign out devices</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The one-time invitation link, styled as a summons. */
function JurySummonsDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  return (
    <Dialog open={url !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-t-4 border-dashed border-t-paper-edge sm:max-w-lg">
        <DialogHeader>
          <div className="typewriter text-xs font-bold text-stamp">JURY SUMMONS</div>
          <DialogTitle className="font-heading text-xl">You are summoned to serve as a juror</DialogTitle>
          <DialogDescription>Send this invitation link to one person. It works once, expires in 24 hours, and anyone holding it can take the seat, so share it directly. It is shown only once. Jurors need no API key.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={url ?? ''} aria-label="Invitation link" className="typewriter bg-exhibit" onFocus={(e) => e.currentTarget.select()} />
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(url ?? '').then(
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
  )
}

function UnsealButton({ run, busy, act }: { run: OwnerRunView; busy: boolean; act: Act }) {
  const { submittedCount, pendingCount } = run.review
  if (submittedCount === 0) return <span className="self-center text-xs text-muted-foreground">Unsealing needs at least one filed worksheet.</span>
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button disabled={busy} />}>Unseal the record</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close the jury and reveal the models?</AlertDialogTitle>
          <AlertDialogDescription>
            {plural(submittedCount, 'filed worksheet')} will be included. {pendingCount > 0 ? `${pendingCount} unfinished worksheet${pendingCount === 1 ? '' : 's'} or unused summons${pendingCount === 1 ? '' : 'es'} will be closed and excluded.` : 'No worksheets are unfinished.'} This can’t be undone; a new experiment needs a new hearing.
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
          <AlertDialogAction onClick={() => void act(() => api('POST', `/runs/${run.runId}/reveal`, { body: { acknowledgePendingCount: pendingCount }, revision: run.revision, idempotencyKey: newIntentKey() }), 'Record unsealed')}>Unseal the record</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
