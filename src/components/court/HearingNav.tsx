/**
 * One header for every page of a hearing: breadcrumbs back to the case, then
 * folder tabs that sit on top of the case sheet (Proceedings, Your review,
 * Record, Judgment). Tabs that are not open yet say why instead of vanishing.
 * Pages render the sheet right below with rounded-t-none.
 */

import { Link, useLocation } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Breadcrumbs } from '@/components/common'
import { useShellFocus } from '@/components/shell/ShellContext'
import { CASE_STEPS, caseStep } from '@/lib/court'
import { cn } from '@/lib/utils'

type Role = 'owner' | 'reviewer'

interface Tab {
  to: string
  label: string
  /** Why the tab is not open yet; omitted when it is. */
  locked?: string
}

function isUnsealed(status: string) {
  return status === 'revealed' || status === 'decided'
}

function tabsFor(runId: string, role: Role, status: string, guest: boolean): Tab[] {
  const sealed = isUnsealed(status) ? undefined : 'Opens when the judge unseals the record'
  if (guest) {
    return [
      { to: `/juror/${runId}`, label: 'Your worksheet' },
      { to: `/juror/${runId}/results`, label: 'Record', locked: sealed },
    ]
  }
  if (role === 'reviewer') {
    return [
      { to: `/runs/${runId}/review`, label: 'Your worksheet' },
      { to: `/runs/${runId}/results`, label: 'Record', locked: sealed },
    ]
  }
  const reviewOpen = status === 'reviewing' || isUnsealed(status)
  return [
    { to: `/runs/${runId}`, label: 'Proceedings' },
    { to: `/runs/${runId}/review`, label: 'Your review', locked: reviewOpen ? undefined : 'Opens when deliberation opens' },
    { to: `/runs/${runId}/results`, label: 'Record', locked: sealed },
    { to: `/runs/${runId}/judgment`, label: 'Judgment', locked: sealed },
  ]
}

export function HearingNav({ runId, caseId, caseTitle, role, status }: { runId: string; caseId?: string; caseTitle: string; role: Role; status: string }) {
  const { pathname } = useLocation()
  const guest = pathname.startsWith('/juror/')
  useShellFocus(guest ? undefined : caseId, guest ? undefined : runId)
  const tabs = tabsFor(runId, role, status, guest)

  return (
    <div className="print:hidden">
      <Breadcrumbs items={guest ? [{ label: caseTitle }, { label: 'Hearing' }] : [{ label: 'Your cases', to: '/evaluations' }, { label: caseTitle, to: caseId ? `/evaluations/${caseId}` : undefined }, { label: 'Hearing' }]} />
      <nav aria-label="Hearing" className="flex items-end gap-0.5 overflow-x-auto sm:gap-1">
        {tabs.map((tab) => {
          const current = pathname === tab.to
          const shape = 'flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 pt-2 pb-2.5 text-sm whitespace-nowrap sm:px-4'
          if (tab.locked && !current) {
            return (
              <span key={tab.to} aria-disabled="true" title={tab.locked} className={cn(shape, 'mt-1.5 cursor-not-allowed bg-tab-idle/70 text-tab-idle-foreground/70')}>
                <Lock className="size-3" aria-hidden />
                {tab.label}
                <span className="sr-only">: {tab.locked}</span>
              </span>
            )
          }
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={current ? 'page' : undefined}
              className={cn(
                shape,
                'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                current ? 'bg-paper font-heading font-bold text-foreground ring-1 ring-paper-edge [clip-path:inset(-2px_-2px_0_-2px)]' : 'mt-1.5 bg-manila text-manila-foreground transition-colors duration-150 hover:bg-manila/80',
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

/** "Stage 3 of 5 · Deliberate (review blind)", for captions on hearing pages. */
export function StageLine({ status }: { status: string }) {
  const { step, complete } = caseStep(status)
  const index = CASE_STEPS.findIndex((s) => s.key === step)
  const entry = CASE_STEPS[index]
  return (
    <div>
      Stage {index + 1} of {CASE_STEPS.length} · {entry.name}
      <span className="font-sans text-xs text-muted-foreground"> ({complete ? 'done' : entry.plain.toLowerCase()})</span>
    </div>
  )
}
