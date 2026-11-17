/**
 * One frame for every page of a hearing (D-45): breadcrumbs back to the case,
 * then the opened case folder with a lettered divider per section
 * (Proceedings, Your review, Record, Judgment, Special master; jurors see
 * Your worksheet and Record). Dividers that are not open yet stay visible and say why. The page
 * passes its sheet as children.
 */

import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Breadcrumbs } from '@/components/layout/Page'
import { CaseStage } from '@/components/court/CaseFile'
import { CaseFolder, DividerNav, type DividerLink } from '@/components/court/Folder'
import { useShellFocus } from '@/components/shell/ShellContext'
import { caseStep, docketNumber } from '@/lib/court'
import { isUnsealed } from '@/lib/status'

type Role = 'owner' | 'reviewer'

function dividersFor(runId: string, role: Role, status: string, guest: boolean): DividerLink[] {
  const sealed = isUnsealed(status) ? {} : { locked: 'Opens when the judge unseals the record', lockedShort: 'at unsealing' }
  if (guest) {
    return [
      { to: `/juror/${runId}`, label: 'Your worksheet' },
      { to: `/juror/${runId}/results`, label: 'Record', ...sealed },
    ]
  }
  if (role === 'reviewer') {
    return [
      { to: `/runs/${runId}/review`, label: 'Your worksheet' },
      { to: `/runs/${runId}/results`, label: 'Record', ...sealed },
    ]
  }
  const reviewOpen = status === 'reviewing' || isUnsealed(status)
  return [
    { to: `/runs/${runId}`, label: 'Proceedings' },
    { to: `/runs/${runId}/review`, label: 'Your review', ...(reviewOpen ? {} : { locked: 'Opens when deliberation opens', lockedShort: 'at deliberation' }) },
    { to: `/runs/${runId}/results`, label: 'Record', ...sealed },
    { to: `/runs/${runId}/judgment`, label: 'Judgment', ...sealed },
    { to: `/runs/${runId}/special-master`, label: 'Special master', ...sealed },
  ]
}

/** `actions` sits beside the breadcrumbs, like the case page's ⋯ menu. */
export function HearingFolder({ runId, caseId, caseTitle, role, status, actions, children }: { runId: string; caseId?: string; caseTitle: string; role: Role; status: string; actions?: ReactNode; children: ReactNode }) {
  const { pathname } = useLocation()
  const guest = pathname.startsWith('/juror/')
  useShellFocus(guest ? undefined : caseId, guest ? undefined : runId)

  return (
    <>
      <div className="flex items-start justify-between gap-3 print:hidden">
        <Breadcrumbs items={guest ? [{ label: caseTitle }, { label: 'Hearing' }] : [{ label: 'Your cases', to: '/evaluations' }, { label: caseTitle, to: caseId ? `/evaluations/${caseId}` : undefined }, { label: 'Hearing' }]} />
        {actions}
      </div>
      <CaseFolder docket={caseId ? docketNumber(caseId) : undefined} title={caseTitle} dividers={<DividerNav label="Hearing" items={dividersFor(runId, role, status, guest)} current={pathname} />}>
        {children}
      </CaseFolder>
    </>
  )
}

/** "Stage 3 of 5 · Deliberate (review blind)" with its marks, for captions on hearing pages. */
export function StageLine({ status }: { status: string }) {
  return <CaseStage {...caseStep(status)} />
}
