/**
 * Scheduled repair (spec §10.2): redispatch outbox rows, expire leases,
 * purge tombstoned evaluations, and expire receipts/invites/counters. Also
 * runs the operator credential operations when [vars] enables them.
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { platformDeps } from './server/platform'
import { runCredentialOps } from './server/services/credential-ops'
import { runMaintenance } from './server/services/maintenance'

export const tasks: CronTask[] = [{ name: 'mc-maintenance', intervalMinutes: 1 }]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name !== 'mc-maintenance') return
  const deps = platformDeps(env)
  await deps.ensureSchema()
  await runMaintenance(deps)
  // Operator-only re-keying and post-restore revocation; off unless enabled in [vars] (docs/runbook.md).
  await runCredentialOps(deps)
}
