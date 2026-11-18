import { Gavel, Hourglass, Inbox, type LucideIcon } from 'lucide-react'
import type { DocketStat } from './docket'

const ICON: Record<DocketStat['key'], LucideIcon> = { waiting: Inbox, active: Hourglass, decided: Gavel }

/** Three counts above the docket: a muted label, one big number, one line of detail. */
export function StatCards({ stats }: { stats: DocketStat[] }) {
  return (
    <ul aria-label="At a glance" className="mb-6 grid gap-3 sm:grid-cols-3 sm:gap-4">
      {stats.map((stat) => {
        const Icon = ICON[stat.key]
        return (
          <li key={stat.key} className="paper px-5 py-4">
            <div className="flex items-center gap-2 text-small text-muted-foreground">
              <Icon aria-hidden className="size-3.5 shrink-0" />
              {stat.label}
            </div>
            <div className="mt-1.5 font-display text-3xl leading-none font-medium tracking-[-0.02em] text-foreground tabular-nums">{stat.value}</div>
            <div className="mt-2 truncate text-small text-muted-foreground">{stat.detail}</div>
          </li>
        )
      })}
    </ul>
  )
}
