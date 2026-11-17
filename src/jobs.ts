/**
 * JobRoom handlers. One job = one generation attempt; payload is IDs only.
 * Provider failures are recorded in D1 and the job still returns successfully,
 * so the JobRoom never retries paid work (maxAttempts is 1 as well).
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import type { GenerationJob } from './server/deps'
import { ensureMigrated } from './server/db/migrations'
import { platformDeps } from './server/platform'
import { GENERATION_JOB_TYPE, handleGenerationJob } from './server/services/generation'

function isGenerationJob(payload: unknown): payload is GenerationJob {
  const value = payload as Partial<GenerationJob> | null
  return !!value && typeof value.outboxId === 'string' && typeof value.generationId === 'string' && typeof value.attemptNo === 'number'
}

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type !== GENERATION_JOB_TYPE || !isGenerationJob(job.payload)) {
    throw new Error('Unknown job type')
  }
  const deps = platformDeps(env)
  await ensureMigrated(deps.db)
  const outcome = await handleGenerationJob(deps, job.payload, ctx.signal, `job_${job.id}`)
  return { handled: true, outcome }
}
