/**
 * The worksheet layout shared by a real hearing and the practice sample:
 * the question pager, the case material beside the testimony, and the
 * previous/next row with the page's own action on the right.
 */

import type { ReactNode } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Term } from '@/components/court/CaseFile'
import { Button } from '@/components/ui/button'
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
