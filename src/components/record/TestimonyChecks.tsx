/**
 * One testimony's automatic checks on the record (spec 03 §4.4, D-79): a word and an icon for each
 * status, never colour alone, and the plain reason. Shown only after unsealing.
 */

import { Check, CircleAlert, Minus, X } from 'lucide-react'
import type { CheckResult, CheckStatus } from '@/domain/kits/types'
import { cn } from '@/lib/utils'

export const STATUS_WORD: Record<CheckStatus, string> = { pass: 'Passed', fail: 'Failed', na: 'Does not apply', error: 'Could not run' }

const ICON = { pass: Check, fail: X, na: Minus, error: CircleAlert } as const

export function CheckStatusMark({ status }: { status: CheckStatus }) {
  const Icon = ICON[status]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-caption font-medium whitespace-nowrap', status === 'fail' && 'text-destructive', status === 'error' && 'text-warning', (status === 'na' || status === 'pass') && 'text-muted-foreground', status === 'pass' && 'text-foreground')}>
      <Icon aria-hidden className="size-3.5" />
      {STATUS_WORD[status]}
    </span>
  )
}

export function TestimonyChecks({ results, labels, party }: { results: readonly CheckResult[]; labels: Record<string, string>; party: string }) {
  if (results.length === 0) return null
  return (
    <div className="border-t border-paper-rule pt-2.5">
      <p className="text-caption font-medium text-muted-foreground">Automatic checks</p>
      <ul aria-label={`Automatic checks on ${party}'s testimony`} className="mt-1.5 space-y-1.5">
        {results.map((result) => (
          <li key={result.checkId} className="grid items-start gap-x-3 gap-y-0.5 text-small sm:grid-cols-[7.5rem_1fr]">
            <CheckStatusMark status={result.status} />
            <span>
              <span className="font-medium">{labels[result.checkId] ?? result.checkId}</span>
              <span className="text-muted-foreground"> · {result.reason}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
