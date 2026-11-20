/**
 * Provider-call caps made visible (D-57). The numbers come from GET /quota;
 * the server still enforces every cap when a hearing or retry reserves calls.
 */

import { Gauge } from 'lucide-react'
import type { QuotaView } from '@/lib/dto'
import { formatTime } from '@/lib/format'

/** One line for the keys page: what this judge has left today. */
export function DailyAllowance({ quota }: { quota: QuotaView | null }) {
  if (!quota) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
      <Gauge className="size-4" aria-hidden />
      <span>
        <strong className="font-semibold text-foreground tabular-nums">
          {quota.user.remaining} of {quota.user.limit}
        </strong>{' '}
        provider calls left for you today. One call is one question answered by one model party; retries count too.
      </span>
      <span className="text-caption">Resets {formatTime(quota.resetsAt)}.</span>
    </p>
  )
}

/** Rows for a definition list: the caller's and the deployment's remaining calls. */
export function AllowanceRows({ quota }: { quota: QuotaView }) {
  return (
    <>
      <dt className="text-muted-foreground">Your calls left today</dt>
      <dd className="tabular-nums">
        {quota.user.remaining} of {quota.user.limit}
      </dd>
      <dt className="text-muted-foreground">Deployment calls left</dt>
      <dd className="tabular-nums">
        {quota.globalToday.remaining} of {quota.globalToday.limit} today · {quota.globalLifetime.remaining} of {quota.globalLifetime.limit} in total
      </dd>
    </>
  )
}
