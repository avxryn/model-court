/**
 * Browser-facing DTO types, derived from the server projections so the UI
 * and the allowlisted serializers cannot drift (E02). These are TYPE-ONLY
 * imports: erased at build time, so no server code reaches the bundle. The
 * ESLint boundary rule permits exactly this (allowTypeImports).
 */

import type { ExtractionLimits } from '@/domain/extraction/limits'
import type { QuotaStanding } from '@/domain/quota'
import type { ProviderId } from '@/domain/registry'
import type { CredentialMetadata, KeyCheckView } from '@/server/services/credentials'
import type { EvaluationSummary, getEvaluation } from '@/server/services/evaluations'
import type { getComparison } from '@/server/services/comparison'
import type { getResults, StepUsage } from '@/server/services/results'
import type { AnonymousReview } from '@/server/services/reviews'
import type { getRun } from '@/server/services/runs'
import type { getSpecialMaster } from '@/server/services/special-master'

export type { AnonymousReview, CredentialMetadata, EvaluationSummary, KeyCheckView, StepUsage }

/** GET /quota (D-57): remaining provider calls for the caller and the deployment. */
export type QuotaView = QuotaStanding

type Resolved<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>

export type EvaluationView = Resolved<typeof getEvaluation>
export type OwnerEvaluationView = Extract<EvaluationView, { role: 'owner' }>
export type RunView = Resolved<typeof getRun>
export type OwnerRunView = Extract<RunView, { role: 'owner' }>
export type ResultsView = Resolved<typeof getResults>
export type SpecialMasterView = Resolved<typeof getSpecialMaster>
/** GET /evaluations/:id/comparison (D-70), judge only. */
export type ComparisonView = Resolved<typeof getComparison>

/** One route as the catalog shows it (D-48): registry metadata, never the adapter version. */
export interface CatalogModel {
  key: string
  provider: ProviderId
  modelId: string
  label: string
  line: string
  contextTokens: number
  providerMaxOutputTokens: number
  reasoning: 'off' | 'low'
  retiresNotBefore: string | null
  docsUrl: string
  enabled: boolean
  verifiedAt: string | null
  multiTurnVerifiedAt: string | null
  /** Spec 04 (D-86): a recorded live structured-output call; extraction hearings need it. */
  structuredVerifiedAt: string | null
  /** A recorded live PDF call; native-PDF questions need it. */
  pdfVerifiedAt: string | null
  /** Spec 06 (D-99): a recorded live tool-loop call; tool-use hearings need it. */
  toolsVerifiedAt: string | null
  /** D-118: the route's plain adapter version, so the browser's readiness check knows which features it can carry. */
  adapterVersion: string
}

export interface CatalogView {
  providerRegistryVersion: string
  generationEnabled: boolean
  credentialWritesEnabled: boolean
  providers: Array<{ id: ProviderId; name: string }>
  models: CatalogModel[]
  priceTable: { version: string; readOn: string; sources: Partial<Record<ProviderId, string>> }
  limits: { maxCases: number; configurations: number; /** Spec 07 §9.1: parties × questions. */ maxTestimoniesPerHearing: number; samplesPerAnswer: number; minConfigurations: number; maxOutputTokens: number; reasoningHeadroomTokens: number; maxAttemptsPerGeneration: number; credentialTtlDays: number; dailyPerUser: number; dailyGlobal: number; lifetimeGlobal: number; extraction: ExtractionLimits }
}
