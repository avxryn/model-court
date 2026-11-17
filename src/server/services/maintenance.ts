/**
 * Scheduled repair and cleanup (spec §5.6, §10.2). Bounded batches; shares the
 * conditional SQL used by request paths so concurrent runs are harmless.
 */

import { DAY_MS } from '../db/sql'
import type { Deps } from '../deps'
import { expireCredentials } from './credentials'
import { dispatchOutbox, reconcileLeases } from './generation'
import { dispatchGraderOutbox, reconcileGraderLeases } from './special-master'

export interface MaintenanceReport {
  dispatched: number
  leasesExpired: number
  evaluationsPurged: number
  cleanupFailures: number
  credentialsExpired: number
}

async function purgeEvaluation(deps: Deps, evaluationId: string): Promise<void> {
  const db = deps.db
  const runIds = 'SELECT id FROM runs WHERE evaluation_id = ?'
  const childIds = `SELECT id FROM runs WHERE evaluation_id = ?1
    UNION SELECT i.id FROM invites i JOIN runs r ON r.id = i.run_id WHERE r.evaluation_id = ?1
    UNION SELECT s.id FROM review_sessions s JOIN runs r ON r.id = s.run_id WHERE r.evaluation_id = ?1
    UNION SELECT v.id FROM verdict_revisions v JOIN runs r ON r.id = v.run_id WHERE r.evaluation_id = ?1`
  await db.batch([
    db.prepare(`DELETE FROM command_receipts WHERE entity_id IN (${childIds}) OR operation = 'run.start:' || ?1`).bind(evaluationId),
    db.prepare(`DELETE FROM audit_events WHERE evaluation_id = ? OR run_id IN (${runIds})`).bind(evaluationId, evaluationId),
    // Cascades to runs, generations, attempts, outbox, reservations, sessions, invites, verdicts, run_credentials.
    // Budget counters are separate rows and keep counting consumed calls (no refund by deletion).
    db.prepare(`DELETE FROM evaluations WHERE id = ? AND deleted_at IS NOT NULL`).bind(evaluationId),
    db
      .prepare(`INSERT INTO audit_events (id, event_type, request_id, outcome, metadata_json, created_at) VALUES (?, 'evaluation.purge', 'cron', 'ok', '{}', ?)`)
      .bind(deps.newId(), deps.now()),
  ])
}

export async function runMaintenance(deps: Deps): Promise<MaintenanceReport> {
  const db = deps.db
  const now = deps.now()
  const report: MaintenanceReport = { dispatched: 0, leasesExpired: 0, evaluationsPurged: 0, cleanupFailures: 0, credentialsExpired: 0 }

  report.dispatched = await dispatchOutbox(deps)
  report.leasesExpired = await reconcileLeases(deps)
  // Special master (D-40): same repair for grader calls.
  report.dispatched += await dispatchGraderOutbox(deps)
  report.leasesExpired += await reconcileGraderLeases(deps)
  report.credentialsExpired = await expireCredentials(deps)

  // Hard-delete tombstoned trees once no attempt can still commit (lease expired or terminal).
  const tombstoned = await db
    .prepare(
      `SELECT e.id FROM evaluations e WHERE e.deleted_at IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM generation_attempts a JOIN generations g ON g.id = a.generation_id JOIN runs r ON r.id = g.run_id
         WHERE r.evaluation_id = e.id AND a.status = 'running' AND a.deadline_at > ?)
       AND NOT EXISTS (
         SELECT 1 FROM grader_attempts ga JOIN grader_items gi ON gi.id = ga.grader_item_id JOIN grader_runs gr ON gr.id = gi.grader_run_id JOIN runs r2 ON r2.id = gr.run_id
         WHERE r2.evaluation_id = e.id AND ga.status = 'running' AND ga.deadline_at > ?)
       ORDER BY e.deleted_at LIMIT 10`,
    )
    .bind(now, now)
    .all<{ id: string }>()
  for (const row of tombstoned.results) {
    try {
      await purgeEvaluation(deps, row.id)
      await deps.purgeNotices(row.id)
      report.evaluationsPurged++
    } catch {
      report.cleanupFailures++
      deps.log({ event: 'cleanup.failed', evaluationId: row.id })
    }
  }

  await db.batch([
    db.prepare('DELETE FROM command_receipts WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM invites WHERE redeemed_at IS NULL AND expires_at <= ?').bind(now - 7 * DAY_MS),
    db.prepare('DELETE FROM rate_buckets WHERE window_start < ?').bind(now - 60 * 60_000),
    // Per-day quota rows are kept for their window plus 24h; the lifetime row (window 0) is kept.
    db.prepare('DELETE FROM budget_buckets WHERE window_start > 0 AND window_start < ?').bind(now - 2 * DAY_MS),
    // Revoked credentials: metadata kept only while a run references it, then 24h.
    db
      .prepare(
        `DELETE FROM command_receipts WHERE entity_id IN (
           SELECT id FROM provider_credentials c WHERE c.status = 'revoked' AND c.revoked_at <= ? AND NOT EXISTS (SELECT 1 FROM run_credentials rc WHERE rc.credential_id = c.id))`,
      )
      .bind(now - DAY_MS),
    db
      .prepare(`DELETE FROM provider_credentials WHERE status = 'revoked' AND revoked_at <= ? AND NOT EXISTS (SELECT 1 FROM run_credentials rc WHERE rc.credential_id = provider_credentials.id)`)
      .bind(now - DAY_MS),
    db.prepare('DELETE FROM audit_events WHERE evaluation_id IS NULL AND run_id IS NULL AND created_at <= ?').bind(now - 30 * DAY_MS),
  ])

  deps.log({ event: 'maintenance', ...report })
  return report
}
