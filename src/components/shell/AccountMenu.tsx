/**
 * The one account control (sidebar footer, mobile bar). Signed in: avatar,
 * name, and a menu; signed out: a Sign in button that opens the auth overlay.
 * The static landing page renders AccountChip (no SDK import) instead.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthOverlay, signOut, useAuthProfileReady } from 'deepspace'
import { ChevronsUpDown, FolderOpen, KeyRound, LogIn, LogOut } from 'lucide-react'
import { AccountAvatar } from '@/components/shell/AccountChip'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { clearAccountHint, writeAccountHint } from '@/lib/account-hint'
import { pendingInviteToken } from '@/lib/invite-token'
import { cn } from '@/lib/utils'

export function AccountMenu({ className }: { className?: string }) {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const navigate = useNavigate()
  const [showAuth, setShowAuth] = useState(false)

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn && user) writeAccountHint(user)
    else if (!isSignedIn) clearAccountHint()
  }, [isLoaded, isSignedIn, user])

  const handleSignOut = () => {
    // Clear protected client state before the SDK reloads the page.
    pendingInviteToken.clear()
    clearAccountHint()
    void signOut()
  }

  if (!isLoaded) return <div className={cn('h-10', className)} />
  if (isSignedIn && (userLoading || !user)) return <div className={cn('h-10 animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)} aria-label="Loading account" />

  if (!isSignedIn || !user) {
    return (
      <>
        <Button data-testid="nav-sign-in-button" variant="outline" className={cn("w-full bg-paper", className)} onClick={() => setShowAuth(true)}>
          <LogIn aria-hidden /> Sign in
        </Button>
        {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
      </>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className={cn('h-11 w-full justify-start gap-2.5 px-2 text-left', className)} aria-label="Account menu">
            <AccountAvatar imageUrl={user.imageUrl} initial={(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()} />
            <span className="min-w-0 flex-1">
              <span data-testid="nav-user-name" className="block truncate text-sm font-medium">
                {user.name || user.email}
              </span>
              {user.name && user.email && <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>}
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="truncate font-medium text-foreground">{user.name || 'Signed in'}</div>
            <div data-testid="nav-user-email" className="truncate text-xs font-normal text-muted-foreground">
              {user.email}
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/evaluations')}>
          <FolderOpen aria-hidden /> Your cases
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/settings/api-keys')}>
          <KeyRound aria-hidden /> Provider keys
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
