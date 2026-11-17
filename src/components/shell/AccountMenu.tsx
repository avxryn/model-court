/**
 * The one account control (sidebar footer, mobile bar). Signed in: avatar,
 * name, and a menu; signed out: a Sign in button that opens the auth overlay.
 * The static landing page renders AccountChip (no SDK import) instead.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthOverlay, signOut, useAuthProfileReady } from 'deepspace'
import { ChevronsUpDown, FolderOpen, KeyRound, LogIn, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { AccountAvatar } from '@/components/shell/AccountChip'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { clearAccountHint, writeAccountHint } from '@/lib/account-hint'
import { pendingInviteToken } from '@/lib/invite-token'
import { setThemeChoice, useTheme, type ThemeChoice } from '@/lib/theme'
import { cn } from '@/lib/utils'

/** `compact`: the avatar alone, for the sidebar rail on wide screens. */
export function AccountMenu({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const navigate = useNavigate()
  const [showAuth, setShowAuth] = useState(false)
  const { choice } = useTheme()

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
        <Button data-testid="nav-sign-in-button" variant="outline" className={cn('w-full bg-paper', compact && 'lg:size-9 lg:px-0', className)} onClick={() => setShowAuth(true)} aria-label={compact ? 'Sign in' : undefined}>
          <LogIn aria-hidden /> <span className={cn(compact && 'lg:sr-only')}>Sign in</span>
        </Button>
        {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
      </>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className={cn('h-11 w-full justify-start gap-2.5 px-2 text-left', compact && 'lg:size-10 lg:justify-center lg:px-0', className)} aria-label="Account menu">
            <AccountAvatar imageUrl={user.imageUrl} initial={(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()} />
            <span className={cn('min-w-0 flex-1', compact && 'lg:hidden')}>
              <span data-testid="nav-user-name" className="block truncate text-sm font-medium">
                {user.name || user.email}
              </span>
              {user.name && user.email && <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>}
            </span>
            <ChevronsUpDown className={cn('size-4 text-muted-foreground', compact && 'lg:hidden')} aria-hidden />
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
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={choice} onValueChange={(value) => setThemeChoice(value as ThemeChoice)}>
            <DropdownMenuRadioItem value="light">
              <Sun aria-hidden /> Paper
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon aria-hidden /> Desk at night
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor aria-hidden /> Match the system
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
