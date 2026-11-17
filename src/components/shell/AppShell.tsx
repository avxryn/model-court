/**
 * The frame every in-app page shares. "full": the sidebar drawer beside the
 * page. "focused": a plain top bar, for people who arrive by link and should
 * see only one task (accepting a summons, a guest juror's worksheet).
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { Sidebar } from '@/components/shell/Sidebar'

export function AppShell({ variant = 'full', children }: { variant?: 'full' | 'focused'; children: ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      {variant === 'focused' ? (
        <div className="flex min-h-screen flex-col bg-background">
          <header data-testid="app-navigation" className="border-b border-drawer-edge bg-drawer print:hidden">
            <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
              <Link to="/" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <BrandMark />
              </Link>
            </div>
          </header>
          <main id="main" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      ) : (
        <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Sidebar />
          <main id="main" className="min-w-0">
            {children}
          </main>
        </div>
      )}
    </>
  )
}
