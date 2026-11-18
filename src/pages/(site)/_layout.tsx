/**
 * The public site around the pages the landing links to (sample, glossary,
 * privacy, terms, accessibility): the landing's header and footer, not the app
 * sidebar. No DeepSpace providers, so these pages make no auth or API request
 * (F19). "Your cases" and "Sign in" in the header lead into the app.
 */

import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome'
import { APP_NAME } from '@/constants'
import { readAccountHint, type AccountHint } from '@/lib/account-hint'

export default function SiteLayout() {
  const [hint, setHint] = useState<AccountHint | null>(null)
  useEffect(() => setHint(readAccountHint()), [])
  const { pathname, hash } = useLocation()
  // A client-side move between pages starts at the top (or at the linked term).
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])
  return (
    <div data-testid="public-site" className="flex min-h-screen flex-col bg-background text-foreground">
      <title>{APP_NAME}</title>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <SiteHeader hint={hint} />
      <main id="main" className="min-w-0 flex-1">
        <Suspense fallback={<div className="flex h-64 items-center justify-center text-muted-foreground">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  )
}
