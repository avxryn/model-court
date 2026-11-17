/** Status names for hearings, generations, worksheets and summonses, with a tone for each. */

export type StatusTone = 'neutral' | 'active' | 'good' | 'warn' | 'bad'

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  generating: { label: 'Generating', tone: 'active' },
  ready: { label: 'Ready for review', tone: 'neutral' },
  reviewing: { label: 'Under review', tone: 'active' },
  revealed: { label: 'Revealed', tone: 'good' },
  decided: { label: 'Verdict recorded', tone: 'good' },
  canceled: { label: 'Canceled', tone: 'bad' },
  pending: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'active' },
  succeeded: { label: 'Succeeded', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  uncertain: { label: 'Uncertain', tone: 'warn' },
  draft: { label: 'In progress', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'good' },
  closed: { label: 'Closed unsubmitted', tone: 'warn' },
  revoked: { label: 'Removed', tone: 'bad' },
  unused: { label: 'Unused', tone: 'neutral' },
  redeemed: { label: 'Joined', tone: 'good' },
  expired: { label: 'Expired', tone: 'warn' },
}

export function statusInfo(status: string): { label: string; tone: StatusTone } {
  return STATUS[status] ?? { label: status, tone: 'neutral' }
}

/** A small status dot for dense lists (the sidebar); always paired with text or a title. */
export const TONE_DOT: Record<StatusTone, string> = {
  neutral: 'bg-mark',
  active: 'bg-primary',
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
}

/** The record is open: findings, identities and the judgment can be shown. */
export function isUnsealed(status: string | undefined): boolean {
  return status === 'revealed' || status === 'decided'
}

/** The hearing still has work in flight (generation or deliberation). */
export function isActive(status: string | undefined): boolean {
  return status === 'generating' || status === 'ready' || status === 'reviewing'
}
