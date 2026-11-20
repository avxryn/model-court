import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { SlipList } from '@/components/court/Paper'
import { SaveIndicator, type SaveState } from '@/components/feedback/SaveIndicator'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { plural } from '@/lib/format'

/**
 * The case's save and start controls, stuck to the bottom of the screen while
 * the case is on it. What still blocks the hearing is one click away. Its side
 * padding matches the sheet body (px-5, sm:px-8), so Save lines up with the content (D-120).
 */
export function CaseActionBar({ saveState, dirty, canSave, onSave, calls, blockers, start }: { saveState: SaveState; dirty: boolean; canSave: boolean; onSave: () => void; calls: number; blockers: string[]; start: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 flex items-center justify-between gap-2 rounded-b-lg border-t border-paper-edge bg-slip/95 px-5 py-2.5 backdrop-blur-sm sm:gap-4 sm:px-8 sm:py-3 print:hidden">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Button variant="outline" disabled={!canSave} onClick={onSave}>
          Save<span className="hidden sm:inline"> draft</span>
        </Button>
        <SaveIndicator state={saveState} onRetry={onSave} />
        {dirty && saveState === 'idle' && <span className="hidden text-caption text-muted-foreground sm:inline">Unsaved changes</span>}
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        {blockers.length > 0 ? <Blockers blockers={blockers} /> : <CallCount calls={calls} />}
        {start}
      </div>
    </div>
  )
}

function Blockers({ blockers }: { blockers: string[] }) {
  return (
    <Popover>
      {/* The same full name at every width; phones only see the shorter text. */}
      <PopoverTrigger render={<Button variant="ghost" className="px-2 text-warning hover:text-warning" aria-label={`${blockers.length} ${blockers.length === 1 ? 'thing' : 'things'} to do before the hearing`} />}>
        <AlertTriangle aria-hidden />
        {blockers.length}
        <span className="sm:hidden"> to do</span>
        <span className="hidden sm:inline"> {blockers.length === 1 ? 'thing' : 'things'} to do before the hearing</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[min(26rem,calc(100vw-2rem))] gap-2 rounded-md border border-border bg-slip px-5 py-4 shadow-lg ring-0">
        <PopoverTitle className="court-label">Before the hearing can start</PopoverTitle>
        <SlipList items={blockers} className="text-foreground/80" />
      </PopoverContent>
    </Popover>
  )
}

function CallCount({ calls }: { calls: number }) {
  return (
    <span className="text-small text-muted-foreground tabular-nums">
      {calls > 0 ? (
        <>
          <strong className="text-foreground">{plural(calls, 'paid call')}</strong>
          <span className="hidden md:inline">, billed to your keys</span>
        </>
      ) : (
        <>
          <strong className="text-foreground">No paid calls</strong>
          <span className="hidden md:inline">: imported answers only</span>
        </>
      )}
    </span>
  )
}
