/**
 * The opened case folder (D-45): a manila back panel with a spine, the case's
 * file label in the folder's top-left corner, lettered index dividers for the
 * sections beside it, and a short stack of paper with the current sheet on top.
 *
 * The label names the case and is not clickable; every clickable tab is a
 * divider. The open divider is the white sheet in front; the others are buff
 * card underneath. Phones drop the label (the caption names the case).
 * Printing drops the folder, the label, the dividers and the sheet edges.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

export function CaseFolder({ docket, title, dividers, children }: { docket?: string; title: string; dividers?: ReactNode; children: ReactNode }) {
  return (
    <div className="folder-back relative rounded-lg bg-manila pt-2 pr-1.5 pb-1.5 pl-2.5 sm:pt-4 sm:pr-5 sm:pb-6 sm:pl-8 lg:pr-7 lg:pl-10 print:contents">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-linear-to-r from-paper-edge to-manila sm:w-4 print:hidden" />
      <div className={cn('relative z-[2] flex items-end gap-3 sm:gap-4 print:hidden', !dividers && 'sm:pb-3')}>
        <span className="hidden max-w-[45%] min-w-0 shrink-0 items-baseline gap-2.5 self-center rounded-[1px] border-t-[3px] border-stamp bg-paper px-2.5 pt-0.5 pb-1 ring-1 ring-paper-edge sm:flex">
          {docket && <span className="typewriter text-[0.8125rem] font-bold whitespace-nowrap text-stamp">{docket}</span>}
          <span className="truncate font-heading text-sm">{title}</span>
        </span>
        {dividers}
      </div>
      <div className="relative">
        <span aria-hidden className="absolute inset-[12px_-10px_-9px_9px] -rotate-[0.35deg] rounded-sm bg-slip ring-1 ring-paper-edge max-sm:hidden print:hidden" />
        <span aria-hidden className="absolute inset-[4px_-3px_-3px_2px] rotate-[0.25deg] rounded-sm bg-paper ring-1 ring-paper-edge sm:inset-[6px_-5px_-5px_4px] print:hidden" />
        {children}
      </div>
    </div>
  )
}

const ROW = 'relative -mx-1 -mt-1 -mb-px flex min-w-0 items-end gap-0.5 overflow-x-auto px-1 pt-1 [scrollbar-width:none] sm:gap-1'

/** The shape of a divider; `state` picks the open, idle, or locked card. */
export function dividerClass(state: 'open' | 'idle' | 'locked') {
  return cn(
    'group/divider relative flex shrink-0 items-center gap-1.5 rounded-t-md px-2 text-[0.8125rem] whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-3.5 sm:text-sm',
    state === 'open' && 'z-[1] h-10 bg-paper font-heading font-bold text-foreground ring-1 ring-paper-edge [clip-path:inset(-4px_-4px_0_-4px)]',
    state === 'idle' && 'divider-under mb-px h-8 bg-tab-idle text-tab-idle-foreground hover:text-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:hover:not-data-active:-translate-y-0.5',
    state === 'locked' && 'mb-px h-8 cursor-not-allowed border border-dashed border-paper-edge bg-tab-idle/50 text-tab-idle-foreground/75',
  )
}

/** Index letter on a divider: A, B, C… */
function Letter({ index }: { index: number }) {
  return (
    <span aria-hidden className="typewriter text-[0.6875rem] font-bold text-mark group-aria-[current=page]/divider:text-stamp group-data-active/divider:text-stamp">
      {String.fromCharCode(65 + index)}
    </span>
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
      {items.map((item, index) => {
        const open = item.to === current
        if (item.locked && !open) {
          return (
            <span key={item.to} aria-disabled="true" title={item.locked} className={dividerClass('locked')}>
              <Letter index={index} />
              {item.label}
              <Lock className="size-3" aria-hidden />
              {item.lockedShort && <span className="hidden font-sans text-[0.6875rem] text-muted-foreground sm:inline">{item.lockedShort}</span>}
              <span className="sr-only">: {item.locked}</span>
            </span>
          )
        }
        return (
          <Link key={item.to} to={item.to} aria-current={open ? 'page' : undefined} className={dividerClass(open ? 'open' : 'idle')}>
            <Letter index={index} />
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
      {items.map((item, index) => (
        <TabsPrimitive.Tab
          key={item.value}
          value={item.value}
          className={cn(dividerClass('idle'), 'data-active:z-[1] data-active:mb-0 data-active:h-10 data-active:bg-paper data-active:font-heading data-active:font-bold data-active:text-foreground data-active:[box-shadow:inset_0_0_0_1px_var(--paper-edge)] data-active:[clip-path:inset(-4px_-4px_0_-4px)]')}
        >
          <Letter index={index} />
          {item.label}
          {item.count !== undefined && (
            <span className="typewriter text-xs font-normal text-muted-foreground">
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
