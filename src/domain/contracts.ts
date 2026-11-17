/**
 * Request/response contracts shared by the browser and the Worker (E02).
 * Server routes always re-validate; client use is for feedback only.
 */

import { z } from 'zod'
import { LIMITS } from './limits'
import { PROVIDERS } from './registry'
import { codePointLength, hasDisallowedControlChars, utf8ByteLength } from './text'

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'Invalid id')

function text(bounds: { min: number; max: number }, label: string) {
  return z.string().refine(
    (value) => {
      const length = codePointLength(value)
      return length >= bounds.min && length <= bounds.max
    },
    {
      message:
        bounds.min > 0
          ? `${label} must be ${bounds.min}–${bounds.max.toLocaleString('en-US')} characters`
          : `${label} must be at most ${bounds.max.toLocaleString('en-US')} characters`,
    },
  )
}

// ---------------------------------------------------------------------------
// Draft: cases, configurations, comparison mode
// ---------------------------------------------------------------------------

export const comparisonModeSchema = z.enum(['model', 'configuration'])
export type ComparisonMode = z.infer<typeof comparisonModeSchema>

export const caseInputSchema = z.strictObject({
  key: uuid,
  title: text(LIMITS.caseTitle, 'Title'),
  input: text(LIMITS.caseInput, 'Input'),
  reference: text(LIMITS.caseReference, 'Reference'),
  expectedBehavior: text(LIMITS.caseExpectedBehavior, 'Expected behavior'),
})
export type CaseInput = z.infer<typeof caseInputSchema>

export const configurationSchema = z.strictObject({
  key: uuid,
  label: text(LIMITS.configurationLabel, 'Label'),
  modelKey: z.string().min(1).max(80),
  systemPrompt: text(LIMITS.systemPrompt, 'System instructions'),
  maxOutputTokens: z.literal(LIMITS.maxOutputTokens),
})
export type Configuration = z.infer<typeof configurationSchema>

function uniqueKeys(items: { key: string }[]): boolean {
  return new Set(items.map((item) => item.key)).size === items.length
}

export const draftInputSchema = z
  .strictObject({
    comparisonMode: comparisonModeSchema,
    cases: z
      .array(caseInputSchema)
      .min(LIMITS.minCases, `Add at least ${LIMITS.minCases} case`)
      .max(LIMITS.maxCases, `At most ${LIMITS.maxCases} cases`)
      .refine(uniqueKeys, 'Case keys must be unique'),
    configurations: z
      .array(configurationSchema)
      .length(LIMITS.configurationsPerRun, `Exactly ${LIMITS.configurationsPerRun} configurations`)
      .refine(uniqueKeys, 'Configuration keys must be unique'),
  })
  .refine((draft) => utf8ByteLength(JSON.stringify(draft)) <= LIMITS.draftJsonBytes, {
    message: 'Draft exceeds 96 KiB',
  })
export type DraftInput = z.infer<typeof draftInputSchema>
export type Draft = DraftInput & { schemaVersion: 1 }

// ---------------------------------------------------------------------------
// Evaluations and runs
// ---------------------------------------------------------------------------

export const createEvaluationSchema = z.strictObject({
  title: text(LIMITS.evaluationTitle, 'Title'),
  taskDescription: text(LIMITS.taskDescription, 'Task description'),
})

export const deleteEvaluationSchema = z.strictObject({ confirmTitle: z.string().max(200) })

export const providerSchema = z.enum(PROVIDERS)

export const startRunSchema = z.strictObject({
  draftRevision: z.number().int().min(1),
  credentialIdsByProvider: z.partialRecord(providerSchema, uuid),
  consentToProviderProcessing: z.literal(true),
  acknowledgeProviderCharges: z.literal(true),
})

export const retrySchema = z.strictObject({
  generationIds: z.array(uuid).min(1).max(LIMITS.maxCases * LIMITS.configurationsPerRun),
  acknowledgePossiblePriorCharge: z.literal(true),
})

export const cancelRunSchema = z.strictObject({ reason: z.string().max(500).optional() })

export const openReviewSchema = z.strictObject({ acknowledgeExcludedCases: z.boolean() })

export const emptySchema = z.strictObject({})

export const redeemInviteSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid invitation token'),
})

// ---------------------------------------------------------------------------
// Ratings and review
// ---------------------------------------------------------------------------

export const scoreSchema = z.union([z.literal(0), z.literal(1), z.literal(2)])
export type Score = z.infer<typeof scoreSchema>

/** A saved draft rating may be partial; submission requires every value. */
export const draftRatingSchema = z.strictObject({
  responseId: uuid,
  correctness: scoreSchema.nullable(),
  completeness: scoreSchema.nullable(),
  grounding: scoreSchema.nullable(),
  note: z.string().refine((v) => codePointLength(v) <= LIMITS.ratingNote.max, {
    message: `Note must be at most ${LIMITS.ratingNote.max} characters`,
  }),
  suspectedIdentityClue: z.boolean(),
})
export type DraftRating = z.infer<typeof draftRatingSchema>

export const saveRatingsSchema = z.strictObject({
  ratings: z.array(draftRatingSchema).max(LIMITS.maxCases * LIMITS.configurationsPerRun),
})

export const revealSchema = z.strictObject({
  acknowledgePendingCount: z.number().int().min(0).max(LIMITS.invitedReviewersPerRun + 1),
})

export const verdictSchema = z
  .strictObject({
    outcome: z.enum(['selected', 'tie', 'inconclusive']),
    selectedConfigurationKey: uuid.optional(),
    rationale: text(LIMITS.verdictRationale, 'Rationale'),
    limitations: text(LIMITS.verdictLimitations, 'Limitations'),
  })
  .refine((v) => (v.outcome === 'selected') === (v.selectedConfigurationKey !== undefined), {
    message: 'Choose a configuration only for a "selected" verdict',
    path: ['selectedConfigurationKey'],
  })
export type VerdictInput = z.infer<typeof verdictSchema>

// ---------------------------------------------------------------------------
// Provider credentials
// ---------------------------------------------------------------------------

export const createCredentialSchema = z.strictObject({
  provider: providerSchema,
  label: text(LIMITS.credentialLabel, 'Label'),
  apiKey: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, 'Enter an API key')
    .refine((value) => utf8ByteLength(value) <= LIMITS.credentialKeyBytes, 'API key is too long')
    .refine((value) => !hasDisallowedControlChars(value) && !/\s/.test(value), 'API key contains invalid characters'),
  consentToStorage: z.literal(true),
  replacesCredentialId: uuid.optional(),
}).superRefine((value, ctx) => {
  // D-23: organization/admin keys can manage billing, members, and other keys.
  // Model Court only needs a project (OpenAI) or workspace (Anthropic) key.
  if (ADMIN_KEY_PREFIXES.some((prefix) => value.apiKey.startsWith(prefix))) {
    ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'Admin keys are not accepted. Create a project (OpenAI) or workspace (Anthropic) API key with access only to the model you need.' })
  }
})

/** Known prefixes of provider organization-admin keys (best-effort, not a guarantee). */
export const ADMIN_KEY_PREFIXES = ['sk-admin-', 'sk-ant-admin'] as const
