/** Recoverable errors: a failed load, stale data, and the one not-found page. */

import { AlertCircle, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { ApiClientError } from '@/lib/api-client'

export function ErrorPanel({ error, onRetry, title = 'Could not load this page' }: { error: ApiClientError; onRetry?: () => void; title?: string }) {
  if (error.status === 404) return <NotFoundPanel />
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {error.message}
        {error.requestId && <span className="mt-1 block text-caption opacity-80">Reference: {error.requestId}</span>}
      </AlertDescription>
      {onRetry && (
        <AlertAction>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}

export function StaleNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert className="mb-4">
      <AlertCircle aria-hidden />
      <AlertTitle>Showing the last loaded data</AlertTitle>
      <AlertDescription>Refreshing failed. Your saved work is not affected.</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Refresh
        </Button>
      </AlertAction>
    </Alert>
  )
}

/** Identical for missing, deleted, and unauthorized resources (spec §7.4). */
export function NotFoundPanel() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span aria-hidden className="mx-auto mb-5 grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground ring-1 ring-foreground/10">
        <Search className="size-5" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-2 text-small leading-relaxed text-muted-foreground">This page does not exist, was deleted, or is not shared with your account.</p>
      <Button className="mt-6" render={<Link to="/evaluations" />} nativeButton={false}>
        Back to your cases
      </Button>
    </div>
  )
}
