/**
 * Outermost shell: tooltip provider, toast host, error boundary.
 * Toasts only supplement inline status; they never carry the sole error.
 */

import { Suspense } from 'react'
import { Outlet, useRouteError } from 'react-router-dom'
import { ErrorScreen } from '../components/ErrorScreen'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function App() {
  return (
    <TooltipProvider>
      {/* data-testid="app-root" is the scaffold's canonical "shell mounted" hook. */}
      <div data-testid="app-root" className="min-h-screen bg-background text-foreground">
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>}>
          <Outlet />
        </Suspense>
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

export function Catch() {
  const error = useRouteError()
  return <ErrorScreen error={error} />
}

export function HydrateFallback() {
  return <div className="flex min-h-screen items-center justify-center bg-background text-small text-muted-foreground">Loading…</div>
}
