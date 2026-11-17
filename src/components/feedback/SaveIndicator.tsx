import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
