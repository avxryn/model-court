import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthOverlay, signOut, useAuthProfileReady } from 'deepspace'
import { ChevronDown, LogOut, Menu, X } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { pendingInviteToken } from '../lib/invite-token'
import { nav } from '../nav'
import { BrandMark } from './BrandMark'

export default function Navigation() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const profileReady = !isSignedIn || (!userLoading && !!user)

  useEffect(() => setMobileOpen(false), [location.pathname])

  const link = (item: (typeof nav)[number]) => {
    const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? 'page' : undefined}
        className={cn('rounded-md px-3 py-1.5 text-sm transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50', active ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground')}
      >
        {item.label}
      </Link>
    )
  }

  const handleSignOut = () => {
    // Clear protected client state before the SDK reloads the page.
    pendingInviteToken.clear()
    void signOut()
  }

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <nav data-testid="app-navigation" aria-label="Primary" className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/evaluations" className="flex items-center gap-2 rounded-md text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <BrandMark />
          </Link>
          <div className="hidden items-center gap-1 md:flex">{nav.map(link)}</div>
          <div className="flex-1" />
          {!isLoaded ? null : isSignedIn && !profileReady ? (
            <div className="h-8 w-28 animate-pulse rounded-full bg-muted" aria-label="Loading account" />
          ) : isSignedIn && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" className="h-9 gap-2 rounded-full pl-1 pr-2.5" aria-label="Account menu">
                    <Avatar className="size-7">
                      <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" alt="" />
                      <AvatarFallback className="text-xs">{(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span data-testid="nav-user-name" className="hidden max-w-[140px] truncate text-sm sm:inline">
                      {user.name || user.email}
                    </span>
                    <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="truncate font-medium text-foreground">{user.name || 'Signed in'}</div>
                    <div data-testid="nav-user-email" className="truncate text-xs font-normal text-muted-foreground">
                      {user.email}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button data-testid="nav-sign-in-button" onClick={() => setShowAuth(true)}>
              Sign in
            </Button>
          )}
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen((open) => !open)} aria-label="Toggle menu" aria-expanded={mobileOpen}>
            {mobileOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </Button>
        </div>
        {mobileOpen && <div className="flex flex-col gap-1 border-t border-border px-3 py-3 md:hidden">{nav.map(link)}</div>}
      </nav>
      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </>
  )
}
