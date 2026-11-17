import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { statusInfo, type StatusTone } from '@/lib/status'
import { cn } from '@/lib/utils'

const TONE: Record<StatusTone, string> = {
  neutral: 'border-border bg-secondary text-secondary-foreground',
  active: 'border-primary/20 bg-primary/10 text-primary',
  good: 'border-success/25 bg-success/10 text-success',
  warn: 'border-warning/30 bg-warning/10 text-warning',
  bad: 'border-destructive/25 bg-destructive/10 text-destructive',
}

const ICON = { active: Loader2, good: CheckCircle2, bad: AlertCircle, warn: AlertCircle, neutral: Clock } satisfies Record<StatusTone, unknown>

/** Status is always text plus an icon shape, never color alone. Pass `label` to override the text. */
export function StatusBadge({ status, label, tone, className }: { status: string; label?: string; tone?: StatusTone; className?: string }) {
  const entry = statusInfo(status)
  const t = tone ?? entry.tone
  const Icon = ICON[t]
  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', TONE[t], className)}>
      <Icon aria-hidden className={cn('size-3', t === 'active' && status !== 'reviewing' && 'animate-spin motion-reduce:animate-none')} />
      {label ?? entry.label}
    </Badge>
  )
}
