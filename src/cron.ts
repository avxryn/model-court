/**
 * Scheduled repair (spec §10.2): redispatch outbox rows, expire leases,
 * purge tombstoned evaluations, and expire receipts/invites/counters. Also
 * runs the operator credential operations when [vars] enables them, and the
 * sealed store backups (V9, D-117) once `BACKUP_PUBLIC_KEY` is set.
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { platformDeps } from './server/platform'
import { runCredentialOps } from './server/services/credential-ops'
import { runMaintenance } from './server/services/maintenance'
import { runBackup } from './server/services/store-backup'

export const tasks: CronTask[] = [
  { name: 'mc-maintenance', intervalMinutes: 1 },
  // V9 (D-117): one sealed backup a day, at a quiet hour.
  { name: 'mc-backup', schedule: '17 3 * * *', timezone: 'America/Chicago' },
]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name === 'mc-backup') {
    const deps = platformDeps(env)
    await deps.ensureSchema()
    for (const problem of deps.config.backup.problems) deps.log({ event: 'backup.config_problem', problem })
    await runBackup(deps, deps.backupFiles, 'scheduled')
    return
  }
  if (name !== 'mc-maintenance') return
  const deps = platformDeps(env)
  await deps.ensureSchema()
  await runMaintenance(deps)
  // Operator-only re-keying and post-restore revocation; off unless enabled in [vars] (docs/runbook.md).
  await runCredentialOps(deps)
  // V9: a backup the operator asked for (before a deploy that rebuilds tables); one per request.
  if (deps.config.backup.requestedAt !== null) await runBackup(deps, deps.backupFiles, 'requested')
}
