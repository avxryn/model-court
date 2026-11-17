/**
 * The small set of side-effect boundaries the services use (E07/E08).
 * Production wiring lives in src/server/platform.ts; tests substitute only the
 * external boundaries (identity token issuer, job queue, notices, provider fetch).
 */

import type { ModelRoute } from '../domain/registry'
import type { AppConfig } from './config'

export interface VerifiedCaller {
  userId: string
  name: string | null
}

export interface GenerationJob {
  outboxId: string
  generationId: string
  attemptNo: number
}

export interface Deps {
  db: D1Database
  /** Make sure the schema exists before use (idempotent). */
  ensureSchema: () => Promise<unknown>
  config: AppConfig
  routes: readonly ModelRoute[]
  now: () => number
  newId: () => string
  /** Verify a platform bearer token; null when missing/invalid/expired. */
  verifyToken: (token: string) => Promise<VerifiedCaller | null>
  /** Enqueue one generation job (IDs only). Resolves with the platform job id. */
  enqueueGeneration: (job: GenerationJob) => Promise<string>
  /** Special-master grading jobs (D-40); IDs only. */
  enqueueGrading: (job: { outboxId: string; graderItemId: string; attemptNo: number }) => Promise<string>
  /** Best-effort safe invalidation notices; failures never fail a command. */
  publishNotices: (notices: Array<{ recipientUserId: string; evaluationId: string; runId: string | null }>) => Promise<void>
  /** Remove every notice that refers to a purged evaluation. */
  purgeNotices: (evaluationId: string) => Promise<void>
  /** Fetch used only by the fixed-endpoint provider adapters. */
  providerFetch: typeof fetch
  /** Structured, allowlisted operational log line (no content, no secrets). */
  log: (event: Record<string, string | number | boolean | null>) => void
}
