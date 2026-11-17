/**
 * The worksheet layout shared by a real hearing and the practice sample:
 * the question pager, the case material beside the testimony, and the
 * previous/next row with the page's own action on the right.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Term } from '@/components/court/CaseFile'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

/** Q1…Qn, the current one inked in, finished ones ticked. */
export function QuestionPager({ count, current, isDone, onSelect, className }: { count: number; current: number; isDone: (index: number) => boolean; onSelect: (index: number) => void; className?: string }) {
  return (
    <nav aria-label="Questions" className={cn('flex max-w-full flex-wrap gap-1', className)}>
      {Array.from({ length: count }, (_, index) => {
        const open = index === current
        return (
          <Button
            key={index}
            size="sm"
            variant="ghost"
            className={cn('h-9 px-3 font-heading', open ? 'bg-foreground text-paper hover:bg-foreground hover:text-paper' : 'text-muted-foreground hover:bg-slip')}
            aria-current={open ? 'step' : undefined}
            onClick={() => onSelect(index)}
          >
            {isDone(index) && <CheckCircle2 aria-label="scored" className={open ? 'text-paper' : 'text-success'} />}Q{index + 1}
          </Button>
        )
      })}
    </nav>
  )
}

/** The question on the left (sticky on wide screens), the testimony cards on the right. */
export function WorksheetGrid({ material, children, columns = 2 }: { material: ReactNode; children: ReactNode; columns?: number }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="lg:sticky lg:top-4 lg:self-start">{material}</div>
      <div className="space-y-3">
        <h2 className="court-label">
          <Term name="testimony" />
        </h2>
        <div className={cn('grid gap-6', columns > 1 && 'xl:grid-cols-2')}>{children}</div>
      </div>
    </div>
  )
}

/** Previous / Next question, and on the right the page's own action (file, unseal) with its progress. */
export function QuestionStepper({ current, count, onGo, children }: { current: number; count: number; onGo: (index: number) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-foreground pt-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={current === 0} onClick={() => onGo(current - 1)}>
          <ChevronLeft aria-hidden /> Previous question
        </Button>
        <Button variant="outline" disabled={current === count - 1} onClick={() => onGo(current + 1)}>
          Next question <ChevronRight aria-hidden />
        </Button>
      </div>
      {children && <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">{children}</div>}
    </div>
  )
}

function focusTestimony(article: Element | undefined) {
  if (!article) return
  const target = article.querySelector<HTMLElement>('[role=radio][data-checked]') ?? article.querySelector<HTMLElement>('[role=radio]')
  target?.focus()
  article.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

/**
 * J and K move to the next and previous testimony, on to the next or previous
 * question at either end; focus lands on the first line of its worksheet, so
 * 0, 1 or 2 scores it straight away. Ignored while typing in a field.
 */
export function useWorksheetKeys({ onNextQuestion, onPreviousQuestion }: { onNextQuestion?: () => Promise<void> | void; onPreviousQuestion?: () => Promise<void> | void }) {
  const handlers = useRef({ onNextQuestion, onPreviousQuestion })
  handlers.current = { onNextQuestion, onPreviousQuestion }
  useEffect(() => {
    const onKey = async (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if ((key !== 'j' && key !== 'k') || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio'))) return
      if (document.querySelector('[role=dialog], [role=alertdialog]')) return
      event.preventDefault()
      const articles = [...document.querySelectorAll('[data-testimony]')]
      const current = articles.findIndex((article) => article.contains(document.activeElement))
      const next = key === 'j' ? current + 1 : current === -1 ? articles.length - 1 : current - 1
      if (next >= 0 && next < articles.length) return focusTestimony(articles[next])
      const move = key === 'j' ? handlers.current.onNextQuestion : handlers.current.onPreviousQuestion
      if (!move) return
      await move()
      requestAnimationFrame(() => {
        const fresh = [...document.querySelectorAll('[data-testimony]')]
        focusTestimony(key === 'j' ? fresh[0] : fresh.at(-1))
      })
    }
    const listener = (event: KeyboardEvent) => void onKey(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}

/** The worksheet's keys, as keycaps. Hidden on small screens, where there is rarely a keyboard. */
export function WorksheetKeyLegend() {
  return (
    <p className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex" aria-label="Keyboard: 0, 1 or 2 scores the focused line; J and K move to the next and previous testimony">
      <Kbd>0</Kbd>
      <Kbd>1</Kbd>
      <Kbd>2</Kbd>
      <span aria-hidden>score the line</span>
      <span aria-hidden className="mx-1 text-mark">·</span>
      <Kbd>J</Kbd>
      <Kbd>K</Kbd>
      <span aria-hidden>next / previous testimony</span>
    </p>
  )
}
