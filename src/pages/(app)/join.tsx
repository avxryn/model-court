/**
 * Invitation redemption (F09, spec §9.3). Lives outside the gated group so it
 * can move the fragment token into short-lived session storage *before* any
 * sign-in redirect, then redeem after authentication.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuth } from 'deepspace'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, describeError } from '@/lib/api-client'
import { pendingInviteToken } from '@/lib/invite-token'

export default function JoinPage() {
  const { isLoaded, isSignedIn } = useAuth()
  const navigate = useNavigate()
  const [showAuth, setShowAuth] = useState(false)
  const [status, setStatus] = useState<'idle' | 'redeeming' | 'error' | 'missing'>('idle')
  const [message, setMessage] = useState('')
  const started = useRef(false)
  const [guestName, setGuestName] = useState('')
  const [guest, setGuest] = useState<{ runId: string; resumeLink: string | null } | null>(null)
  const [guestBusy, setGuestBusy] = useState(false)

  // A resume link (D-41) adds this browser as another device for a guest juror, but only after a click,
  // so a link someone else sent can never silently switch this browser into their seat.
  const [pendingResume, setPendingResume] = useState<string | null>(null)
  useEffect(() => {
    const match = /(?:^#|&)resume=([A-Za-z0-9_-]{43})/.exec(window.location.hash)
    if (!match) return
    window.history.replaceState(null, '', window.location.pathname)
    setPendingResume(match[1])
  }, [])
  const resume = async () => {
    if (!pendingResume) return
    setGuestBusy(true)
    try {
      const result = await api<{ runId: string; resumeSecret?: string }>('POST', '/juror/resume', { body: { resume: pendingResume } })
      setPendingResume(null)
      // Each link works once; this device gets the next one.
      setGuest({ runId: result.runId, resumeLink: result.resumeSecret ? `${window.location.origin}/join#resume=${result.resumeSecret}` : null })
    } catch (error) {
      setStatus('error')
      setMessage(describeError(error))
    } finally {
      setGuestBusy(false)
    }
  }

  const joinAsGuest = async () => {
    const token = pendingInviteToken.peek()
    if (!token) return
    setGuestBusy(true)
    try {
      const result = await api<{ runId: string; resumeSecret?: string }>('POST', '/invites/redeem-as-guest', { body: { token, displayName: guestName.trim() } })
      pendingInviteToken.clear()
      setGuest({ runId: result.runId, resumeLink: result.resumeSecret ? `${window.location.origin}/join#resume=${result.resumeSecret}` : null })
    } catch (error) {
      setStatus('error')
      setMessage(describeError(error))
    } finally {
      setGuestBusy(false)
    }
  }

  // Read the secret from the fragment once and remove it from the address bar.
  useEffect(() => {
    const match = /(?:^#|&)token=([A-Za-z0-9_-]{43})/.exec(window.location.hash)
    if (match) {
      pendingInviteToken.save(match[1])
      window.history.replaceState(null, '', window.location.pathname)
    } else if (!pendingInviteToken.peek() && !/resume=/.test(window.location.hash)) {
      setStatus('missing')
    }
  }, [])

  useEffect(() => {
    if (!isLoaded || !isSignedIn || started.current) return
    const token = pendingInviteToken.peek()
    if (!token) return
    started.current = true
    setStatus('redeeming')
    api<{ runId: string }>('POST', '/invites/redeem', { body: { token } })
      .then((result) => {
        pendingInviteToken.clear()
        navigate(`/runs/${result.runId}/review`, { replace: true })
      })
      .catch((error: unknown) => {
        pendingInviteToken.clear()
        setStatus('error')
        setMessage(describeError(error))
      })
  }, [isLoaded, isSignedIn, navigate])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <Card className="paper w-full max-w-md rounded-[2px] border-t-4 border-dashed border-t-paper-edge py-7">
        <CardHeader>
          <div className="typewriter mb-2 text-xs font-bold text-stamp">JURY SUMMONS · MODEL COURT</div>
          <CardTitle className="font-heading text-2xl font-bold">You are summoned to serve as a juror</CardTitle>
          <CardDescription className="leading-relaxed">
            You were invited to review blind. You will score anonymous AI answers against a short rubric. You don’t need an API key, and you won’t see which models gave the answers — or anyone else’s ratings — until the judge unseals the record.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-2 space-y-4">
          {status === 'missing' && !pendingResume && !guest && <p className="text-sm text-destructive">This page needs an invitation link. Ask the judge for a new one.</p>}
          {status === 'error' && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          {status === 'redeeming' && (
            <p role="status" className="text-sm text-muted-foreground">
              Joining…
            </p>
          )}
          {pendingResume && !guest && (
            <div className="space-y-3 rounded-[2px] bg-slip p-4 text-sm">
              <p className="font-medium">Continue your review on this device?</p>
              <p>Use this only with a resume link you saved yourself. Anyone else’s link would put you in their seat.</p>
              <Button className="w-full" disabled={guestBusy} onClick={() => void resume()}>
                {guestBusy ? 'Continuing…' : 'Continue on this device'}
              </Button>
            </div>
          )}
          {guest && (
            <div className="space-y-3 rounded-[2px] bg-slip p-4 text-sm">
              <p className="font-medium">You are seated as a juror.</p>
              {guest.resumeLink && (
                <div className="space-y-1.5">
                  <p>Save this link to continue on another device. It works once and is shown only once; anyone with it can act as you.</p>
                  <div className="flex gap-2">
                    <Input readOnly value={guest.resumeLink} aria-label="Resume link" className="typewriter bg-white" onFocus={(e) => e.currentTarget.select()} />
                    <Button variant="outline" onClick={() => void navigator.clipboard.writeText(guest.resumeLink ?? '').then(() => toast.success('Link copied'), () => toast.error('Copy failed — select the link and copy it manually.'))}>
                      Copy
                    </Button>
                  </div>
                </div>
              )}
              <Button className="w-full" onClick={() => navigate(`/juror/${guest.runId}`)}>
                Open your worksheet
              </Button>
            </div>
          )}
          {isLoaded && !isSignedIn && status !== 'missing' && status !== 'redeeming' && !guest && !pendingResume && (
            <>
              <Button className="w-full" onClick={() => setShowAuth(true)}>
                Sign in to accept the summons
              </Button>
              <form
                className="space-y-2 border-t border-paper-rule pt-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void joinAsGuest()
                }}
              >
                <Label htmlFor="guest-name">Or join with just a name</Label>
                <Input id="guest-name" value={guestName} maxLength={40} onChange={(e) => setGuestName(e.target.value)} placeholder="The name the judge will see" />
                <p className="text-xs text-muted-foreground">No account needed. Only the judge sees this name. This browser keeps you signed in to this one hearing for up to 14 days.</p>
                <Button type="submit" variant="outline" className="mt-2 w-full" disabled={guestBusy || guestName.trim().length === 0}>
                  {guestBusy ? 'Joining…' : 'Join without an account'}
                </Button>
              </form>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  pendingInviteToken.clear()
                  navigate('/')
                }}
              >
                Decline
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </div>
  )
}
