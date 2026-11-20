/**
 * Four or five testimonies (spec 07 §9.2, D-111): one at a time at full width, with tabs A–E that
 * show which are scored, and "Compare two" to read two side by side. `[` and `]` move to the previous
 * and next testimony; J and K step through the deck's testimonies before moving to the next or
 * previous question (the worksheet's own J/K, review finding D-112). Every testimony is the same kind of card whichever party wrote it; the deck
 * only chooses which are on screen, so blinding is the worksheet's own. Give it `key={question}` so a
 * new question opens on its first testimony.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Columns2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsList, TabsContent, TabsTrigger } from '@/components/ui/tabs'
import { deckStep } from '@/domain/parties'
import { cn } from '@/lib/utils'

export interface DeckItem {
  key: string
  /** The blind label ("A"…"E") on the worksheet; the party's own label on the unsealed record. */
  label: string
  /** Scored (worksheet only). */
  done?: boolean
  node: ReactNode
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return !!element && (element.isContentEditable || element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && element.type !== 'checkbox' && element.type !== 'radio'))
}

function DeckTabs({ items, value, onChange, exclude, label, noun }: { items: readonly DeckItem[]; value: string; onChange: (key: string) => void; exclude?: string; label: string; noun: string }) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(String(next))} className="min-w-0 gap-3">
      <div className="max-w-full overflow-x-auto">
        <TabsList aria-label={label}>
          {items.map((item) => (
            <TabsTrigger key={item.key} value={item.key} disabled={item.key === exclude} className="min-w-12 px-2.5">
              {item.done && <CheckCircle2 aria-label="scored" className="text-success" />}
              <span>
                <span className="sr-only">{noun} </span>
                {item.label}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {items.map((item) => (
        <TabsContent key={item.key} value={item.key} className="min-w-0 outline-none">
          {item.node}
        </TabsContent>
      ))}
    </Tabs>
  )
}

export function TestimonyDeck({ items, noun = 'Testimony', keys = true }: { items: readonly DeckItem[]; /** "Testimony" on the worksheet, "Party" on the record. */ noun?: string; /** `[` and `]` (one deck per page). */ keys?: boolean }) {
  const [primary, setPrimary] = useState(items[0]?.key ?? '')
  const [compare, setCompare] = useState(false)
  const [secondary, setSecondary] = useState(items[1]?.key ?? '')
  const current = useRef({ items, primary })
  current.current = { items, primary }
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!keys) return
    /** Focus the first line of the open testimony on the left, once it has rendered. */
    const focusOpen = () =>
      requestAnimationFrame(() => {
        const article = root.current?.querySelector('[data-deck-pane="left"] [data-testimony]')
        const target = article?.querySelector<HTMLElement>('[role=radio][data-checked]') ?? article?.querySelector<HTMLElement>('[role=radio]')
        target?.focus()
      })
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!['[', ']', 'j', 'k'].includes(key) || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      if (document.querySelector('[role=dialog], [role=alertdialog]')) return
      const { items: list, primary: open } = current.current
      const left = root.current?.querySelector('[data-deck-pane="left"]')
      const step = deckStep(
        list.map((item) => item.key),
        open,
        key === ']' || key === 'j' ? 1 : -1,
        // [ and ] always move; J and K first land on the open testimony.
        key === '[' || key === ']' || (!!left && left.contains(document.activeElement)),
      )
      if (step === 'pass') return
      // Before the worksheet's own J/K handler (bubble phase): this testimony, then the next one, then the next question.
      event.preventDefault()
      event.stopImmediatePropagation()
      if (step !== 'focus') setPrimary(step)
      if (key === 'j' || key === 'k') focusOpen()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [keys])
  // The compare pane never shows the testimony that is already open on the left.
  const other = secondary !== primary && items.some((item) => item.key === secondary) ? secondary : (items.find((item) => item.key !== primary)?.key ?? '')
  return (
    <div ref={root} className="space-y-3" data-testimony-deck>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground">
          {items.length} testimonies, one at a time. {items.filter((item) => item.done).length > 0 && `${items.filter((item) => item.done).length} of ${items.length} scored.`}
        </p>
        <div className="flex items-center gap-2">
          {keys && (
            <span className="hidden items-center gap-1 text-caption text-muted-foreground md:flex" aria-hidden>
              <Kbd>[</Kbd>
              <Kbd>]</Kbd>
              previous / next
            </span>
          )}
          <Button type="button" size="sm" variant="outline" aria-pressed={compare} onClick={() => setCompare((value) => !value)} className={cn(compare && 'bg-muted')}>
            <Columns2 aria-hidden /> Compare two
          </Button>
        </div>
      </div>
      <div className={cn('grid gap-4', compare && 'lg:grid-cols-2')}>
        <div data-deck-pane="left" className="min-w-0">
          <DeckTabs items={items} value={primary} onChange={setPrimary} label={compare ? `${noun} on the left` : `${noun}`} noun={noun} />
        </div>
        {compare && (
          <div data-deck-pane="right" className="min-w-0">
            <DeckTabs items={items} value={other} onChange={setSecondary} exclude={primary} label={`${noun} on the right`} noun={noun} />
          </div>
        )}
      </div>
    </div>
  )
}
