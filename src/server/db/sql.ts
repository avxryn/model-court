/**
 * Guarded D1 batches and shared statement builders (spec §5.4).
 *
 * D1 does not roll back a batch because an UPDATE matched zero rows, so every
 * multi-statement command starts with a guard row whose CHECK (ok = 1) aborts
 * the whole batch when any mutable precondition is false at commit time.
 * Condition SQL comes only from code in this repository; values are bound.
 */

export interface Condition {
  sql: string
  binds: unknown[]
}

export class GuardFailed extends Error {
  constructor(readonly guard: string) {
    super(`Guard failed: ${guard}`)
  }
}

export function all(...conditions: Condition[]): Condition {
  return {
    sql: conditions.map((condition) => `(${condition.sql})`).join(' AND ') || '1',
    binds: conditions.flatMap((condition) => condition.binds),
  }
}

export function cond(sql: string, ...binds: unknown[]): Condition {
  return { sql, binds }
}

export type ConstraintKind = 'guard' | 'receipt' | 'active_run' | 'budget' | 'session_unique' | 'active_credential' | 'immutable' | 'other'

export function classifyConstraint(error: unknown): ConstraintKind | null {
  const message = error instanceof Error ? error.message : String(error)
  if (!/constraint|IMMUTABLE_/i.test(message)) return null
  if (message.includes('ok = 1')) return 'guard'
  if (message.includes('command_receipts.')) return 'receipt'
  if (message.includes('runs.evaluation_id')) return 'active_run'
  if (message.includes('allocated_units')) return 'budget'
  if (message.includes('review_sessions.run_id')) return 'session_unique'
  if (message.includes('provider_credentials.owner_user_id')) return 'active_credential'
  if (message.includes('IMMUTABLE_')) return 'immutable'
  return 'other'
}

/**
 * Execute statements atomically behind a guard. Throws GuardFailed when the
 * guard condition is false; other constraint errors propagate for the caller
 * to classify (for example a duplicate receipt or a budget ceiling).
 */
export async function runGuarded(db: D1Database, guard: string, condition: Condition, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  const guardId = crypto.randomUUID()
  try {
    const results = await db.batch([
      db
        .prepare(`INSERT INTO command_guards (id, name, ok) VALUES (?, ?, CASE WHEN ${condition.sql} THEN 1 ELSE 0 END)`)
        .bind(guardId, guard, ...condition.binds),
      ...statements,
      db.prepare('DELETE FROM command_guards WHERE id = ?').bind(guardId),
    ])
    return results.slice(1, -1)
  } catch (error) {
    if (classifyConstraint(error) === 'guard') throw new GuardFailed(guard)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Budget buckets (spec §6.5): call-count ceilings, not currency.
// ---------------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000

export function utcDayStart(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS
}

export interface BudgetSubjects {
  actor: string
  global: string
  lifetime: string
  windowStart: number
}

export function budgetSubjects(ownerUserId: string, now: number): BudgetSubjects {
  return { actor: `user:${ownerUserId}`, global: 'global:day', lifetime: 'global:lifetime', windowStart: utcDayStart(now) }
}

/** Reserve `units` against all three buckets; the bucket CHECK aborts the batch at a ceiling. */
export function reserveBudget(
  db: D1Database,
  subjects: BudgetSubjects,
  units: number,
  limits: { dailyPerUser: number; dailyGlobal: number; lifetimeGlobal: number },
  now: number,
): D1PreparedStatement[] {
  const buckets: Array<[string, number, number]> = [
    [subjects.actor, subjects.windowStart, limits.dailyPerUser],
    [subjects.global, subjects.windowStart, limits.dailyGlobal],
    [subjects.lifetime, 0, limits.lifetimeGlobal],
  ]
  return buckets.flatMap(([subject, windowStart, limit]) => [
    db
      .prepare(
        `INSERT INTO budget_buckets (subject, window_start, limit_units, allocated_units, updated_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT (subject, window_start) DO UPDATE SET limit_units = excluded.limit_units, updated_at = excluded.updated_at`,
      )
      .bind(subject, windowStart, limit, now),
    db
      .prepare('UPDATE budget_buckets SET allocated_units = allocated_units + ?, updated_at = ? WHERE subject = ? AND window_start = ?')
      .bind(units, now, subject, windowStart),
  ])
}

/**
 * Release every reservation still in `fromState` that matches `scopeSql`
 * (a WHERE fragment over attempt_reservations aliased `r`), decrementing each
 * bucket exactly once, then mark those reservations released. Only call this
 * for work proven never sent to a provider.
 */
export function releaseReservations(db: D1Database, scope: Condition, fromState: 'reserved' | 'consumed', now: number, table: 'attempt_reservations' | 'grader_reservations' = 'attempt_reservations'): D1PreparedStatement[] {
  const matching = `FROM ${table} r WHERE r.state = '${fromState}' AND (${scope.sql})`
  const decrement = (column: 'actor_subject' | 'global_subject' | 'lifetime_subject', windowSql: string) =>
    db
      .prepare(
        `UPDATE budget_buckets SET allocated_units = allocated_units - (
           SELECT COUNT(*) ${matching} AND r.${column} = budget_buckets.subject AND ${windowSql}
         ), updated_at = ?
         WHERE EXISTS (SELECT 1 ${matching} AND r.${column} = budget_buckets.subject AND ${windowSql})`,
      )
      .bind(...scope.binds, now, ...scope.binds)
  return [
    decrement('actor_subject', 'r.window_start = budget_buckets.window_start'),
    decrement('global_subject', 'r.window_start = budget_buckets.window_start'),
    decrement('lifetime_subject', 'budget_buckets.window_start = 0'),
    db
      .prepare(`UPDATE ${table} SET state = 'released' WHERE rowid IN (SELECT r.rowid ${matching})`)
      .bind(...scope.binds),
  ]
}

// ---------------------------------------------------------------------------
// Audit (spec §9.5): opaque IDs, codes, and counts only — never content.
// ---------------------------------------------------------------------------

export interface AuditEvent {
  eventType: string
  requestId: string
  outcome: string
  actorUserId?: string | null
  evaluationId?: string | null
  runId?: string | null
  metadata?: Record<string, string | number | boolean | null>
}

export function auditStatement(db: D1Database, event: AuditEvent, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_events (id, evaluation_id, run_id, actor_user_id, event_type, request_id, outcome, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      event.evaluationId ?? null,
      event.runId ?? null,
      event.actorUserId ?? null,
      event.eventType,
      event.requestId,
      event.outcome,
      JSON.stringify(event.metadata ?? {}),
      now,
    )
}

// ---------------------------------------------------------------------------
// Rate limiting: fixed one-minute windows, separate from provider-call budgets.
// ---------------------------------------------------------------------------

export async function hitRateLimit(db: D1Database, subject: string, limitPerMinute: number, now: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const windowStart = Math.floor(now / 60_000) * 60_000
  const row = await db
    .prepare(
      `INSERT INTO rate_buckets (subject, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT (subject, window_start) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .bind(subject, windowStart)
    .first<{ count: number }>()
  const count = row?.count ?? 1
  return { allowed: count <= limitPerMinute, retryAfterSeconds: Math.ceil((windowStart + 60_000 - now) / 1000) }
}
