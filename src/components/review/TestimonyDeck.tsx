/**
 * Four or five testimonies (spec 07 §9.2, D-111): one at a time at full width, with tabs A–E that
 * show which are scored, and "Compare two" to read two side by side. `[` and `]` move to the previous
 * and next testimony. Every testimony is the same kind of card whichever party wrote it; the deck
 * only chooses which are on screen, so blinding is the worksheet's own. Give it `key={question}` so a
 * new question opens on its first testimony.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Columns2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsList, TabsContent, TabsTrigger } from '@/components/ui/tabs'
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
  useEffect(() => {
    if (!keys) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== '[' && event.key !== ']') || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      if (document.querySelector('[role=dialog], [role=alertdialog]')) return
      const { items: list, primary: open } = current.current
      const index = list.findIndex((item) => item.key === open)
      const next = list[index + (event.key === ']' ? 1 : -1)]
      if (!next) return
      event.preventDefault()
      setPrimary(next.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys])
  // The compare pane never shows the testimony that is already open on the left.
  const other = secondary !== primary && items.some((item) => item.key === secondary) ? secondary : (items.find((item) => item.key !== primary)?.key ?? '')
  return (
    <div className="space-y-3" data-testimony-deck>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {items.length} testimonies, one at a time. {items.filter((item) => item.done).length > 0 && `${items.filter((item) => item.done).length} of ${items.length} scored.`}
        </p>
        <div className="flex items-center gap-2">
          {keys && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground md:flex" aria-hidden>
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
        <DeckTabs items={items} value={primary} onChange={setPrimary} label={compare ? `${noun} on the left` : `${noun}`} noun={noun} />
        {compare && <DeckTabs items={items} value={other} onChange={setSecondary} exclude={primary} label={`${noun} on the right`} noun={noun} />}
      </div>
    </div>
  )
}
