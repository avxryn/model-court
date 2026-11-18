import { Gavel, LockOpen, PenLine, Scale, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { waitingHref, type WaitingItem, type WaitingKind } from './docket'

/** Each next step links to the hearing page that has its action (see waitingHref). */
const STEP: Record<WaitingKind, { title: string; note: string; action: string; icon: LucideIcon; tile: string }> = {
  judgment: { title: 'Enter judgment', note: 'record unsealed', action: 'Enter', icon: Gavel, tile: 'bg-success/10 text-success' },
  unseal: { title: 'Unseal the record', note: 'deliberation open', action: 'Continue', icon: LockOpen, tile: 'bg-stamp/10 text-stamp' },
  open: { title: 'Open deliberation', note: 'testimony is in', action: 'Open', icon: Scale, tile: 'bg-accent text-accent-foreground' },
  review: { title: 'Write your review', note: 'no jurors seated', action: 'Continue', icon: PenLine, tile: 'bg-warning/10 text-warning' },
  score: { title: 'Score the testimony', note: 'jury duty, deliberation open', action: 'Continue', icon: PenLine, tile: 'bg-warning/10 text-warning' },
}

/** What the viewer can move forward now, most decisive first. Only the first row's button is primary. */
export function WaitingOnYou({ items, className }: { items: WaitingItem[]; className?: string }) {
  return (
    <section aria-labelledby="docket-waiting" className={cn('paper overflow-hidden', className)}>
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <h2 id="docket-waiting" className="text-sm font-semibold text-foreground">
          Waiting on you
        </h2>
        {items.length > 0 && <span className="ml-auto text-small text-muted-foreground tabular-nums">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-10 text-center text-small text-muted-foreground">Nothing is waiting on you.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item, index) => {
            const step = STEP[item.kind]
            const Icon = step.icon
            return (
              <li key={item.case.id} className="flex items-start gap-3 px-5 py-3.5">
                <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-md', step.tile)}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{step.title}</div>
                  <div className="mt-0.5 text-small break-words text-muted-foreground">
                    {item.case.title} · {step.note}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={index === 0 ? 'default' : 'outline'}
                  className="shrink-0"
                  render={<Link to={waitingHref(item)} aria-label={`${step.action}: ${step.title}, ${item.case.title}`} />}
                  nativeButton={false}
                >
                  {step.action}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
