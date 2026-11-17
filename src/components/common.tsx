/**
 * Small product-level compositions shared across screens. Each one adds a
 * repeated semantic behavior (status text, save state, recoverable error);
 * none re-implements a primitive.
 */

import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, ChevronRight, Clock, Loader2, Search, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ApiClientError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

export interface Crumb {
  label: ReactNode
  to?: string
}

/** Where this page sits: Your cases › the case › the hearing. The last crumb is the current page. */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('mb-3 print:hidden', className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={index} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-mark" />}
              {item.to && !last ? (
                <Link to={item.to} className="max-w-[16rem] truncate rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn('max-w-[20rem] truncate', last && 'text-foreground')}>
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * The heading of every page that is not a case file: breadcrumbs, a court
 * label, one title size, a short description, and the page's actions.
 */
export function PageHeader({ crumbs, eyebrow, title, description, actions }: { crumbs?: Crumb[]; eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0 space-y-1.5">
          {eyebrow && <div className="court-label">{eyebrow}</div>}
          <h1 className="font-heading text-3xl leading-tight font-bold text-foreground">{title}</h1>
          {description && <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

/** A court term's plain meaning in brackets after a label: "Findings (scores)". */
export function Plain({ children }: { children: ReactNode }) {
  return <span className="inline-block font-sans text-xs font-normal tracking-normal text-muted-foreground normal-case">({children})</span>
}

/** A white exhibit-edged panel inside a sheet: lists, tables, side notes. */
export function Panel({ as: Tag = 'div', className, children }: { as?: 'div' | 'section' | 'ul' | 'ol' | 'li'; className?: string; children: ReactNode }) {
  return <Tag className={cn('exhibit-panel', className)}>{children}</Tag>
}

/** A quiet note on a slip: empty lists and short explanations. */
export function Note({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('rounded-[2px] bg-slip px-5 py-4 text-sm text-muted-foreground', className)}>{children}</p>
}

export function Page({ children, width = 'default' }: { children: ReactNode; width?: 'default' | 'wide' | 'narrow' }) {
  return <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-10', width === 'wide' ? 'max-w-6xl' : width === 'narrow' ? 'max-w-2xl' : 'max-w-4xl')}>{children}</div>
}

const RUN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
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

export type StatusTone = 'neutral' | 'active' | 'good' | 'warn' | 'bad'

export function statusInfo(status: string): { label: string; tone: StatusTone } {
  return RUN_STATUS[status] ?? { label: status, tone: 'neutral' }
}

/** A small status dot for dense lists (the sidebar); always paired with text or a title. */
export const TONE_DOT: Record<StatusTone, string> = {
  neutral: 'bg-mark',
  active: 'bg-primary',
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
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
      <span aria-hidden className="mx-auto mb-5 grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground ring-1 ring-foreground/10">
        <Search className="size-5" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">This page does not exist, was deleted, or is not shared with your account.</p>
      <Button className="mt-6" render={<Link to="/evaluations" />} nativeButton={false}>
        Back to your cases
      </Button>
    </div>
  )
}

export function PageSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="mb-8 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-md max-w-full" />
      </div>
      <div className="paper divide-y divide-paper-rule overflow-hidden rounded-sm">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Designed empty state: what is empty, why, and the next step. */
export function EmptyState({ icon: Icon, title, children, actions }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="paper rounded-sm px-6 py-14 text-center">
      <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-accent text-accent-foreground ring-1 ring-brass/25">
        <Icon className="size-5" />
      </span>
      <h2 className="mt-4 text-xl font-semibold tracking-tight">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
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
  CREDENTIAL_REVOKED: 'The key pinned to this run was removed or expired before this generation ran. Nothing was sent.',
  CREDENTIAL_EXPIRED: 'The key pinned to this run expired before this generation ran. Nothing was sent. Save a new key and start a new run.',
  CREDENTIAL_UNAVAILABLE: 'The saved key could not be used. Nothing was sent.',
  CANCELED: 'Canceled by the judge.',
  DELETED: 'The evaluation was deleted.',
}
