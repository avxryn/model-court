/**
 * Read-only provider-call standing (D-57): what is left of the per-judge daily
 * cap and the deployment's daily and lifetime caps. Counts only; no other
 * user's identity or activity is exposed.
 */

import { quotaStanding, type QuotaStanding } from '../../domain/quota'
import { budgetSubjects } from '../db/sql'
import type { Deps } from '../deps'

export async function getQuota(deps: Deps, userId: string): Promise<QuotaStanding> {
  const now = deps.now()
  const subjects = budgetSubjects(userId, now)
  const rows = (
    await deps.db
      .prepare(
        `SELECT subject, allocated_units FROM budget_buckets
         WHERE (subject = ? AND window_start = ?) OR (subject = ? AND window_start = ?) OR (subject = ? AND window_start = 0)`,
      )
      .bind(subjects.actor, subjects.windowStart, subjects.global, subjects.windowStart, subjects.lifetime)
      .all<{ subject: string; allocated_units: number }>()
  ).results
  const used = (subject: string) => rows.find((row) => row.subject === subject)?.allocated_units ?? 0
  return quotaStanding(deps.config.limits, { userToday: used(subjects.actor), globalToday: used(subjects.global), globalLifetime: used(subjects.lifetime) }, now)
}
