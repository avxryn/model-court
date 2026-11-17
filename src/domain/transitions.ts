/**
 * Legal run and generation states (spec §2.5). The SQL guards in the server
 * repository encode the same rules at commit time; this module is the single
 * readable definition used by services and UI affordances.
 */

export const RUN_STATUSES = ['generating', 'ready', 'reviewing', 'revealed', 'decided', 'canceled'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const GENERATION_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'uncertain', 'canceled'] as const
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['generating', 'ready', 'reviewing']
export const TERMINAL_GENERATION_STATUSES: readonly GenerationStatus[] = ['succeeded', 'failed', 'uncertain', 'canceled']

export type RunCommand = 'retry' | 'cancel' | 'openReview' | 'invite' | 'redeemInvite' | 'saveReview' | 'submitReview' | 'reveal' | 'verdict'

const ALLOWED: Record<RunCommand, readonly RunStatus[]> = {
  retry: ['generating', 'ready'],
  cancel: ['generating', 'ready'],
  openReview: ['ready'],
  invite: ['ready', 'reviewing'],
  redeemInvite: ['reviewing'],
  saveReview: ['reviewing'],
  submitReview: ['reviewing'],
  reveal: ['reviewing'],
  verdict: ['revealed', 'decided'],
}

export function allowedStatuses(command: RunCommand): readonly RunStatus[] {
  return ALLOWED[command]
}

export function canRun(command: RunCommand, status: RunStatus): boolean {
  return ALLOWED[command].includes(status)
}

export function isTerminalGeneration(status: GenerationStatus): boolean {
  return TERMINAL_GENERATION_STATUSES.includes(status)
}

/** A generation may be retried when it has no accepted output and attempts remain. */
export function isRetryable(status: GenerationStatus, attemptCount: number, maxAttempts: number): boolean {
  return (status === 'failed' || status === 'uncertain') && attemptCount < maxAttempts
}

/** Run status implied by its generations while generating/ready. */
export function readinessStatus(generationStatuses: readonly GenerationStatus[]): 'generating' | 'ready' {
  return generationStatuses.every(isTerminalGeneration) ? 'ready' : 'generating'
}
