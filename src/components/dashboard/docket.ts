/**
 * What the "Your cases" page can honestly say from the case list alone.
 * EvaluationSummary carries only the case, the viewer's role, the latest
 * hearing's status and the last activity time, so every count and next step
 * here is derived from those four fields and nothing else.
 */

import type { EvaluationSummary } from '@/lib/dto'
import { plural } from '@/lib/format'

export type ChipTone = 'muted' | 'open' | 'seal' | 'delib' | 'done'

/** The docket's chip for a case, from its latest hearing (the mock's dot chips). */
export function caseChip(status: EvaluationSummary['latestRunStatus']): { label: string; tone: ChipTone } {
  switch (status) {
    case null:
      return { label: 'No hearings', tone: 'muted' }
    case 'generating':
      return { label: 'Generating', tone: 'open' }
    case 'ready':
      return { label: 'Sealed', tone: 'seal' }
    case 'reviewing':
      return { label: 'Deliberating', tone: 'delib' }
    case 'revealed':
      return { label: 'Unsealed', tone: 'open' }
    case 'decided':
      return { label: 'Judgment entered', tone: 'done' }
    case 'canceled':
      return { label: 'Canceled', tone: 'muted' }
    default:
      return { label: String(status), tone: 'muted' }
  }
}

export type WaitingKind = 'judgment' | 'unseal' | 'open' | 'score'

export interface WaitingItem {
  kind: WaitingKind
  case: EvaluationSummary
}

/** Most decisive first: a verdict to record, then a record to unseal, then deliberation to open, then a worksheet. */
const ORDER: WaitingKind[] = ['judgment', 'unseal', 'open', 'score']

/**
 * The next step a case is waiting on from this viewer, if any. Judges move the
 * hearing along (open deliberation, unseal, enter judgment); jurors score while
 * deliberation is open. The summary can't say whether jurors have filed or the
 * viewer already scored, so a deliberating hearing still counts as waiting.
 */
export function waitingKind(item: EvaluationSummary): WaitingKind | null {
  if (item.role === 'reviewer') return item.latestRunStatus === 'reviewing' ? 'score' : null
  switch (item.latestRunStatus) {
    case 'revealed':
      return 'judgment'
    case 'reviewing':
      return 'unseal'
    case 'ready':
      return 'open'
    default:
      return null
  }
}

/** Where a waiting row's button goes: the hearing page that has the action, or the case if the hearing is unknown. */
export function waitingHref(item: WaitingItem): string {
  const runId = item.case.latestRunId
  if (!runId) return `/evaluations/${item.case.id}`
  switch (item.kind) {
    case 'judgment':
      return `/runs/${runId}/judgment`
    case 'score':
      return `/runs/${runId}/review`
    default:
      // Opening deliberation and unsealing are on the hearing's Proceedings page.
      return `/runs/${runId}`
  }
}

export function waitingItems(items: EvaluationSummary[]): WaitingItem[] {
  const found: WaitingItem[] = []
  for (const item of items) {
    const kind = waitingKind(item)
    if (kind) found.push({ kind, case: item })
  }
  return found.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.case.updatedAt - a.case.updatedAt)
}

/** "Two things are waiting on you." for the page description. */
export function waitingSentence(count: number): string {
  if (count === 0) return 'Nothing is waiting on you.'
  if (count === 1) return 'One thing is waiting on you.'
  return `${count} things are waiting on you.`
}

function countBy<T extends string>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function joinParts(parts: Array<string | null>, fallback: string): string {
  const kept = parts.filter((part): part is string => part !== null)
  return kept.length > 0 ? kept.join(', ') : fallback
}

export interface DocketStat {
  key: 'waiting' | 'active' | 'decided'
  label: string
  value: number
  detail: string
}

export function docketStats(items: EvaluationSummary[], waiting: WaitingItem[]): DocketStat[] {
  const byKind = countBy(waiting.map((item) => item.kind))
  const part = (n: number | undefined, text: (n: number) => string) => (n ? text(n) : null)

  const statuses = countBy(items.map((item) => item.latestRunStatus ?? 'none'))
  const generating = statuses.get('generating') ?? 0
  const ready = statuses.get('ready') ?? 0
  const reviewing = statuses.get('reviewing') ?? 0
  const decided = statuses.get('decided') ?? 0

  return [
    {
      key: 'waiting',
      label: 'Waiting on you',
      value: waiting.length,
      detail: joinParts(
        [
          part(byKind.get('judgment'), (n) => `${plural(n, 'judgment')} to enter`),
          part(byKind.get('unseal'), (n) => `${n} to unseal`),
          part(byKind.get('open'), (n) => `${n} to open`),
          part(byKind.get('score'), (n) => `${n} to score`),
        ],
        'Nothing needs you right now',
      ),
    },
    {
      key: 'active',
      label: 'Hearings in progress',
      value: generating + ready + reviewing,
      detail: joinParts(
        [part(generating, (n) => `${n} generating`), part(ready, (n) => `${n} awaiting deliberation`), part(reviewing, (n) => `${n} deliberating`)],
        'No hearings running',
      ),
    },
    {
      key: 'decided',
      label: 'Judgments entered',
      value: decided,
      detail: `Out of ${plural(items.length, 'case')}`,
    },
  ]
}

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "Nov 15", "Nov 15, 2025". */
export function relativeAge(ms: number, now: number): string {
  const diff = Math.max(0, now - ms)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const then = new Date(ms)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const sameYear = then.getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(then)
}
