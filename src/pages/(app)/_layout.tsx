/**
 * The dynamic-app boundary (scaffold contract): DeepSpaceAuthProvider →
 * AuthBoot → RecordProvider → RecordScope, plus the app shell (sidebar).
 * The scaffold's in-browser AgentTools surface is intentionally not mounted.
 */

import { Suspense, useEffect, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { DeepSpaceAuthProvider, RecordProvider, RecordScope, useAuth, useAuthStatus } from 'deepspace'
import { AppShell } from '../../components/shell/AppShell'
import { ShellProvider } from '../../components/shell/ShellContext'
import { APP_NAME, SCOPE_ID } from '../../constants'
import { pendingInviteToken } from '../../lib/invite-token'
import { schemas } from '../../schemas'

export default function AppLayout() {
  // People who arrive by a summons or a guest juror's link see only that task.
  const { pathname } = useLocation()
  const focused = pathname === '/join' || pathname.startsWith('/juror/')
  return (
    <DeepSpaceAuthProvider>
      <title>{APP_NAME}</title>
      <AuthBoot>
        <ShellProvider>
          <AppShell variant={focused ? 'focused' : 'full'}>
            <Suspense fallback={<div className="flex h-64 items-center justify-center text-muted-foreground">Loading…</div>}>
              <Outlet />
            </Suspense>
          </AppShell>
        </ShellProvider>
        <ResumePendingInvite />
      </AuthBoot>
    </DeepSpaceAuthProvider>
  )
}

function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuthStatus()
  if (!isLoaded) return <div aria-busy="true" className="fixed inset-0 bg-background" />
  return (
    <RecordProvider
      allowAnonymous
      onWriteError={(e) => (e.kind === 'permission' ? toast.warning(e.title, { description: e.detail }) : toast.error(e.title, { description: e.detail }))}
    >
      <RecordScope roomId={SCOPE_ID} schemas={schemas}>
        {children}
      </RecordScope>
    </RecordProvider>
  )
}

/** After an OAuth round trip lands on /home, return to /join to finish redemption. */
function ResumePendingInvite() {
  const { isSignedIn } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (isSignedIn && location.pathname !== '/join' && pendingInviteToken.peek()) navigate('/join', { replace: true })
  }, [isSignedIn, location.pathname, navigate])
  return null
}
