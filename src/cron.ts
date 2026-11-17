/**
 * Scheduled repair (spec §10.2): redispatch outbox rows, expire leases,
 * purge tombstoned evaluations, and expire receipts/invites/counters.
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { ensureMigrated } from './server/db/migrations'
import { platformDeps } from './server/platform'
import { runMaintenance } from './server/services/maintenance'

export const tasks: CronTask[] = [{ name: 'mc-maintenance', intervalMinutes: 1 }]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name !== 'mc-maintenance') return
  const deps = platformDeps(env)
  await ensureMigrated(deps.db)
  await runMaintenance(deps)
}
