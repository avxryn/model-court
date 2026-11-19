/**
 * JobRoom handlers. One job = one generation attempt; payload is IDs only.
 * Provider failures are recorded in D1 and the job still returns successfully,
 * so the JobRoom never retries paid work (maxAttempts is 1 as well).
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import type { GenerationJob, ToolStepJob } from './server/deps'
import { platformDeps } from './server/platform'
import { GENERATION_JOB_TYPE, handleGenerationJob } from './server/services/generation'
import { GRADING_JOB_TYPE, handleGradingJob, type GradingJob } from './server/services/special-master'
import { handleToolStepJob, TOOL_STEP_JOB_TYPE } from './server/services/tool-loop'

function isGenerationJob(payload: unknown): payload is GenerationJob {
  const value = payload as Partial<GenerationJob> | null
  return !!value && typeof value.outboxId === 'string' && typeof value.generationId === 'string' && typeof value.attemptNo === 'number'
}

function isGradingJob(payload: unknown): payload is GradingJob {
  const value = payload as Partial<GradingJob> | null
  return !!value && typeof value.outboxId === 'string' && typeof value.graderItemId === 'string' && typeof value.attemptNo === 'number'
}

/** Spec 06 §7.3: IDs and numbers only. */
export function isToolStepJob(payload: unknown): payload is ToolStepJob {
  const value = payload as Partial<ToolStepJob> | null
  return !!value && typeof value.stepOutboxId === 'string' && typeof value.stepId === 'string' && typeof value.generationId === 'string' && typeof value.attemptNo === 'number' && typeof value.stepNo === 'number'
}

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type === TOOL_STEP_JOB_TYPE && isToolStepJob(job.payload)) {
    const deps = platformDeps(env)
    await deps.ensureSchema()
    return { handled: true, outcome: await handleToolStepJob(deps, job.payload, ctx.signal, `job_${job.id}`) }
  }
  if (job.type === GRADING_JOB_TYPE && isGradingJob(job.payload)) {
    const deps = platformDeps(env)
    await deps.ensureSchema()
    return { handled: true, outcome: await handleGradingJob(deps, job.payload, ctx.signal, `job_${job.id}`) }
  }
  if (job.type !== GENERATION_JOB_TYPE || !isGenerationJob(job.payload)) {
    throw new Error('Unknown job type')
  }
  const deps = platformDeps(env)
  await deps.ensureSchema()
  const outcome = await handleGenerationJob(deps, job.payload, ctx.signal, `job_${job.id}`)
  return { handled: true, outcome }
}
