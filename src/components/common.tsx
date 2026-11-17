/**
 * Small product-level compositions shared across screens. Each one adds a
 * repeated semantic behavior (status text, save state, recoverable error);
 * none re-implements a primitive.
 */

import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ApiClientError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Page({ children, width = 'default' }: { children: ReactNode; width?: 'default' | 'wide' | 'narrow' }) {
  return <div className={cn('mx-auto w-full px-4 py-8 sm:py-10', width === 'wide' ? 'max-w-6xl' : width === 'narrow' ? 'max-w-2xl' : 'max-w-4xl')}>{children}</div>
}

const RUN_STATUS: Record<string, { label: string; tone: 'neutral' | 'active' | 'good' | 'warn' | 'bad' }> = {
  generating: { label: 'Generating', tone: 'active' },
  ready: { label: 'Ready for review', tone: 'neutral' },
  reviewing: { label: 'Under review', tone: 'active' },
  revealed: { label: 'Revealed', tone: 'good' },
  decided: { label: 'Verdict recorded', tone: 'good' },
  canceled: { label: 'Canceled', tone: 'bad' },
  pending: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'active' },
  succeeded: { label: 'Succeeded', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  uncertain: { label: 'Uncertain', tone: 'warn' },
  draft: { label: 'In progress', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'good' },
  closed: { label: 'Closed unsubmitted', tone: 'warn' },
  revoked: { label: 'Removed', tone: 'bad' },
  unused: { label: 'Unused', tone: 'neutral' },
  redeemed: { label: 'Joined', tone: 'good' },
  expired: { label: 'Expired', tone: 'warn' },
}

const TONE: Record<string, string> = {
  neutral: 'border-border bg-secondary text-secondary-foreground',
  active: 'border-primary/20 bg-primary/10 text-primary',
  good: 'border-success/25 bg-success/10 text-success',
  warn: 'border-warning/30 bg-warning/10 text-warning',
  bad: 'border-destructive/25 bg-destructive/10 text-destructive',
}

/** Status is always text plus an icon shape, never color alone. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const entry = RUN_STATUS[status] ?? { label: status, tone: 'neutral' as const }
  const Icon = entry.tone === 'active' ? Loader2 : entry.tone === 'good' ? CheckCircle2 : entry.tone === 'bad' || entry.tone === 'warn' ? AlertCircle : Clock
  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', TONE[entry.tone], className)}>
      <Icon aria-hidden className={cn('size-3', entry.tone === 'active' && status !== 'reviewing' && 'animate-spin motion-reduce:animate-none')} />
      {entry.label}
    </Badge>
  )
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2 text-xs">
      {state === 'saving' && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> Saving…
        </span>
      )}
      {state === 'saved' && (
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 className="size-3" aria-hidden /> Saved
        </span>
      )}
      {state === 'error' && (
        <span className="inline-flex items-center gap-2 text-destructive">
          <AlertCircle className="size-3" aria-hidden /> Could not save
          {onRetry && (
            <Button size="xs" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          )}
        </span>
      )}
      {state === 'conflict' && (
        <span className="inline-flex items-center gap-1 text-warning">
          <AlertCircle className="size-3" aria-hidden /> Changed elsewhere
        </span>
      )}
    </span>
  )
}

export function ErrorPanel({ error, onRetry, title = 'Could not load this page' }: { error: ApiClientError; onRetry?: () => void; title?: string }) {
  if (error.status === 404) return <NotFoundPanel />
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {error.message}
        {error.requestId && <span className="mt-1 block text-xs opacity-80">Reference: {error.requestId}</span>}
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
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">This page does not exist, was deleted, or is not shared with your account.</p>
      <Button className="mt-6" render={<Link to="/evaluations" />} nativeButton={false}>
        Back to evaluations
      </Button>
    </div>
  )
}

export function PageSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

export const ERROR_TEXT: Record<string, string> = {
  PROVIDER_AUTH_FAILED: 'The provider rejected the API key. Replace the key in Settings.',
  PROVIDER_ACCESS_DENIED: 'The key does not have access to this model.',
  PROVIDER_MODEL_UNAVAILABLE: 'The model is not available to this key.',
  PROVIDER_QUOTA_EXHAUSTED: 'The provider account is out of credit or quota.',
  PROVIDER_RATE_LIMITED: 'The provider rate-limited the request.',
  PROVIDER_UNAVAILABLE: 'The provider was unavailable.',
  PROVIDER_REJECTED_REQUEST: 'The provider rejected the request.',
  PROVIDER_BLOCKED: 'The provider blocked the response without text.',
  PROVIDER_REDIRECT_REFUSED: 'The provider redirected the request; Model Court refused to forward the key.',
  PROVIDER_TIMEOUT: 'No response within 90 seconds. The provider may still have processed (and charged for) the request.',
  PROVIDER_NETWORK_ERROR: 'The connection failed mid-request. A charge may have occurred.',
  PROVIDER_CANCELED: 'The request was canceled. A charge may have occurred.',
  PROVIDER_LEASE_EXPIRED: 'The generation worker stopped responding. Whether the provider processed the request is unknown.',
  INVALID_PROVIDER_RESPONSE: 'The provider returned a response Model Court could not read.',
  OUTPUT_TOO_LARGE: 'The response exceeded the 16 KiB storage limit and was not kept.',
  EMPTY_OUTPUT: 'The provider returned no text.',
  CREDENTIAL_REVOKED: 'The key pinned to this run was removed before this generation ran. Nothing was sent.',
  CREDENTIAL_UNAVAILABLE: 'The saved key could not be used. Nothing was sent.',
  CANCELED: 'Canceled by the owner.',
  DELETED: 'The evaluation was deleted.',
}
