/**
 * Header and footer of the public site: the landing page and the pages it
 * links to (sample, glossary, legal). No DeepSpace SDK import and no data
 * hooks, so the landing stays static and prerenderable (tests/smoke.spec.ts).
 */

import { Link, NavLink, useLocation } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { AccountChip } from '@/components/shell/AccountChip'
import { Button } from '@/components/ui/button'
import type { AccountHint } from '@/lib/account-hint'
import { cn } from '@/lib/utils'

/** Same width and gutters as the app's wide pages (src/components/layout/Page.tsx). */
export const SITE_CONTAINER = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10'

const NAV_LINK = 'rounded-md px-1 py-1 text-sm whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:font-medium aria-[current=page]:text-foreground'

const LEGAL_LINKS = [
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/accessibility', label: 'Accessibility' },
]

function SiteNav({ className }: { className?: string }) {
  const onLanding = useLocation().pathname === '/'
  return (
    <nav aria-label="Public" className={className}>
      {/* A plain anchor: on another page it loads the landing at that section. */}
      <a href={onLanding ? '#how' : '/#how'} className={NAV_LINK}>
        How it works
      </a>
      <NavLink to="/sample" className={NAV_LINK}>
        Sample case
      </NavLink>
      <NavLink to="/glossary" className={NAV_LINK}>
        Glossary
      </NavLink>
    </nav>
  )
}

export function SiteHeader({ hint }: { hint: AccountHint | null }) {
  const onSample = useLocation().pathname === '/sample'
  return (
    <header className="border-b border-border bg-background print:hidden">
      <div className={cn(SITE_CONTAINER, 'flex h-16 items-center gap-7')}>
        <Link to="/" className="flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <BrandMark />
        </Link>
        <SiteNav className="hidden items-center gap-5 md:flex" />
        <div className="ml-auto flex items-center gap-2.5">
          <AccountChip hint={hint} />
          {!onSample && (
            <Button size="sm" className="hidden sm:inline-flex" render={<Link to="/sample" />} nativeButton={false}>
              Try the sample
            </Button>
          )}
        </div>
      </div>
      <div className={cn(SITE_CONTAINER, 'md:hidden')}>
        <SiteNav className="-mx-1 flex items-center gap-5 overflow-x-auto pb-2.5" />
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border print:hidden">
      <div className={cn(SITE_CONTAINER, 'flex flex-col items-start justify-between gap-3 py-6 text-small text-muted-foreground sm:flex-row sm:items-center')}>
        <Link to="/" className="flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <BrandMark />
        </Link>
        <div className="space-y-1.5 sm:text-right">
          <p>A decision aid, not a benchmark or certification. Not affiliated with or endorsed by OpenAI, Anthropic or Google.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 sm:justify-end">
            {LEGAL_LINKS.map(({ to, label }) => (
              <NavLink key={to} to={to} className={NAV_LINK}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  )
}
