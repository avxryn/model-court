import { Link } from 'react-router-dom'
import { Note, Panel } from '@/components/court/Paper'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatTime } from '@/lib/format'

export interface HearingRow {
  id: string
  status: string
  createdAt: number
}

/** A case's hearings, newest first; each row opens that hearing. `to` picks the page (owner or juror). */
export function HearingList({ runs, to }: { runs: ReadonlyArray<HearingRow>; to: (run: HearingRow) => string }) {
  if (runs.length === 0) return <Note>No hearings yet. Each hearing freezes an unchangeable copy of the saved draft.</Note>
  const newestFirst = [...runs].sort((a, b) => b.createdAt - a.createdAt)
  return (
    <Panel as="ul" className="divide-y divide-paper-rule overflow-hidden">
      {newestFirst.map((run, index) => (
        <li key={run.id}>
          <Link to={to(run)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 outline-none transition-colors duration-150 hover:bg-slip focus-visible:bg-slip focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
            <span className="font-heading">
              Hearing · {formatTime(run.createdAt)}
              {index === 0 && runs.length > 1 && <span className="ml-2 font-sans text-xs text-muted-foreground">latest</span>}
            </span>
            <StatusBadge status={run.status} />
          </Link>
        </li>
      ))}
    </Panel>
  )
}
