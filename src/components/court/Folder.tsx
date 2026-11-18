/**
 * The case's section tabs (D-49, "Docket"): an underlined tab row above the
 * case sheet. The sheet's caption names the case, so the frame adds no label,
 * folder back or paper stack. Locked tabs stay visible and say why.
 * (Named "folder" and "dividers" for history: D-45 drew these as an opened
 * manila folder with index dividers.)
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The tab row (if any) and the sheet below it. `docket` and `title` are kept for callers; the caption shows them. */
export function CaseFolder({ dividers, children }: { docket?: string; title: string; dividers?: ReactNode; children: ReactNode }) {
  return (
    <div className="print:contents">
      {dividers && <div className="mb-5 border-b border-border print:hidden">{dividers}</div>}
      {children}
    </div>
  )
}

const ROW = 'relative -mb-px flex min-w-0 items-end gap-1 overflow-x-auto [scrollbar-width:none]'

/** One tab; `state` picks the open, idle, or locked look. */
export function dividerClass(state: 'open' | 'idle' | 'locked') {
  return cn(
    'group/divider relative flex h-10 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
    state === 'open' && 'border-foreground font-medium text-foreground',
    state === 'idle' && 'border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground',
    state === 'locked' && 'cursor-not-allowed border-transparent text-muted-foreground/70',
  )
}

export interface DividerLink {
  to: string
  label: string
  /** Why the section is not open yet; omitted when it is. */
  locked?: string
  /** A few words for the divider itself, e.g. "at unsealing". */
  lockedShort?: string
}

/** Dividers that are links to the pages of one record (a hearing). */
export function DividerNav({ label, items, current }: { label: string; items: DividerLink[]; current: string }) {
  // On a narrow screen the row scrolls sideways; keep the open divider in view.
  const row = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = row.current
    const open = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !open) return
    const overflow = open.offsetLeft + open.offsetWidth - (nav.scrollLeft + nav.clientWidth)
    if (overflow > 0) nav.scrollLeft += overflow + 8
  }, [current])
  return (
    <nav ref={row} aria-label={label} className={ROW}>
      {items.map((item) => {
        const open = item.to === current
        if (item.locked && !open) {
          return (
            <span key={item.to} aria-disabled="true" title={item.locked} className={dividerClass('locked')}>
              {item.label}
              <Lock className="size-3" aria-hidden />
              {item.lockedShort && <span className="hidden text-xs text-muted-foreground/80 sm:inline">{item.lockedShort}</span>}
              <span className="sr-only">: {item.locked}</span>
            </span>
          )
        }
        return (
          <Link key={item.to} to={item.to} aria-current={open ? 'page' : undefined} className={dividerClass(open ? 'open' : 'idle')}>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * Dividers that switch panels in place (Base UI tabs). Wrap the folder in
 * `Tabs` and put each `TabsContent` inside the sheet.
 */
export function DividerTabs({ label, items }: { label: string; items: Array<{ value: string; label: string; count?: number }> }) {
  return (
    <TabsPrimitive.List aria-label={label} className={ROW}>
      {items.map((item) => (
        <TabsPrimitive.Tab
          key={item.value}
          value={item.value}
          className={cn(dividerClass('idle'), 'data-active:border-foreground data-active:font-medium data-active:text-foreground')}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">
              <span className="sr-only"> (</span>
              {item.count}
              <span className="sr-only">)</span>
            </span>
          )}
        </TabsPrimitive.Tab>
      ))}
    </TabsPrimitive.List>
  )
}
