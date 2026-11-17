/**
 * Browser-facing DTO types, derived from the server projections so the UI
 * and the allowlisted serializers cannot drift (E02). These are TYPE-ONLY
 * imports: erased at build time, so no server code reaches the bundle. The
 * ESLint boundary rule permits exactly this (allowTypeImports).
 */

import type { CredentialMetadata } from '@/server/services/credentials'
import type { EvaluationSummary, getEvaluation } from '@/server/services/evaluations'
import type { getResults } from '@/server/services/results'
import type { AnonymousReview } from '@/server/services/reviews'
import type { getRun } from '@/server/services/runs'

export type { AnonymousReview, CredentialMetadata, EvaluationSummary }

type Resolved<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>

export type EvaluationView = Resolved<typeof getEvaluation>
export type OwnerEvaluationView = Extract<EvaluationView, { role: 'owner' }>
export type RunView = Resolved<typeof getRun>
export type OwnerRunView = Extract<RunView, { role: 'owner' }>
export type ResultsView = Resolved<typeof getResults>

export interface CatalogView {
  providerRegistryVersion: string
  generationEnabled: boolean
  credentialWritesEnabled: boolean
  providers: Array<{ id: 'openai' | 'anthropic'; name: string }>
  models: Array<{ key: string; provider: 'openai' | 'anthropic'; modelId: string; label: string; enabled: boolean; verifiedAt: string | null }>
  limits: { maxCases: number; configurations: number; minConfigurations: number; maxOutputTokens: number; maxAttemptsPerGeneration: number; credentialTtlDays: number; dailyPerUser: number; dailyGlobal: number; lifetimeGlobal: number }
}
