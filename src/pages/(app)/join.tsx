/**
 * Invitation redemption (F09, spec §9.3). Lives outside the gated group so it
 * can move the fragment token into short-lived session storage *before* any
 * sign-in redirect, then redeem after authentication.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuth } from 'deepspace'
import { Button } from '@/components/ui/button'
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

  // Read the secret from the fragment once and remove it from the address bar.
  useEffect(() => {
    const match = /(?:^#|&)token=([A-Za-z0-9_-]{43})/.exec(window.location.hash)
    if (match) {
      pendingInviteToken.save(match[1])
      window.history.replaceState(null, '', window.location.pathname)
    } else if (!pendingInviteToken.peek()) {
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
          {status === 'missing' && <p className="text-sm text-destructive">This page needs an invitation link. Ask the judge for a new one.</p>}
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
          {isLoaded && !isSignedIn && status !== 'missing' && (
            <>
              <Button className="w-full" onClick={() => setShowAuth(true)}>
                Sign in to accept the summons
              </Button>
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
