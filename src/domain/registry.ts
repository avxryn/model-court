/**
 * Direct-generation routes (spec §6.4). Browser-safe: model metadata only.
 *
 * Every route here is a current text model listed in the provider's own model
 * documentation (sources in `docsUrl` and docs/provider-contracts.md, read
 * 2026-11-17). A route is runnable only after a real authorized call has been
 * recorded in docs/provider-contracts.md and `verifiedAt` is set here. Until
 * then the catalog marks it as awaiting its live check and run admission
 * rejects it (F04). Documentation alone never sets `verifiedAt`.
 *
 * Spec 07 (D-108): Google's Gemini API is the third provider. Its routes carry no structured output,
 * PDF input or tool loop (no successor versions), so kits that need those refuse Gemini parties.
 */

export const PROVIDERS = ['openai', 'anthropic', 'google'] as const
export type ProviderId = (typeof PROVIDERS)[number]

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
}

/**
 * How a request treats the model's own reasoning (D-48):
 * - `off`: reasoning or thinking is turned off; the whole output cap is the answer.
 * - `low`: the model always reasons and the API refuses to turn it off, so the
 *   request asks for the lowest effort the model accepts and adds
 *   `LIMITS.reasoningHeadroomTokens` to the output cap. Reasoning is billed as output.
 */
export type ReasoningMode = 'off' | 'low'

/**
 * Every adapter version a snapshot may record. The request body for a version
 * never changes once a hearing has recorded it; a different body is a new
 * version (D-39, D-48). The server maps each version to its transport in
 * `src/server/providers/index.ts`.
 */
export const ADAPTER_PROFILES = {
  'openai-responses-v1': { provider: 'openai', multiTurn: false, reasoning: 'off', structuredOutput: false, pdfInput: false, toolUse: false },
  'openai-responses-v2': { provider: 'openai', multiTurn: true, reasoning: 'off', structuredOutput: false, pdfInput: false, toolUse: false },
  'openai-responses-reasoning-low-v1': { provider: 'openai', multiTurn: true, reasoning: 'low', structuredOutput: false, pdfInput: false, toolUse: false },
  'anthropic-messages-v1': { provider: 'anthropic', multiTurn: false, reasoning: 'off', structuredOutput: false, pdfInput: false, toolUse: false },
  'anthropic-messages-v2': { provider: 'anthropic', multiTurn: true, reasoning: 'off', structuredOutput: false, pdfInput: false, toolUse: false },
  'anthropic-messages-between-tools-v1': { provider: 'anthropic', multiTurn: true, reasoning: 'off', structuredOutput: false, pdfInput: false, toolUse: false },
  'anthropic-messages-adaptive-low-v1': { provider: 'anthropic', multiTurn: true, reasoning: 'low', structuredOutput: false, pdfInput: false, toolUse: false },
  // Spec 04 §6.4 (D-86): structured output and PDF input. Without either feature each body is
  // byte-identical to its predecessor's (unit-tested).
  'openai-responses-v3': { provider: 'openai', multiTurn: true, reasoning: 'off', structuredOutput: true, pdfInput: true, toolUse: false },
  'openai-responses-reasoning-low-v2': { provider: 'openai', multiTurn: true, reasoning: 'low', structuredOutput: true, pdfInput: true, toolUse: false },
  'anthropic-messages-v3': { provider: 'anthropic', multiTurn: true, reasoning: 'off', structuredOutput: true, pdfInput: true, toolUse: false },
  'anthropic-messages-between-tools-v2': { provider: 'anthropic', multiTurn: true, reasoning: 'off', structuredOutput: true, pdfInput: true, toolUse: false },
  'anthropic-messages-adaptive-low-v2': { provider: 'anthropic', multiTurn: true, reasoning: 'low', structuredOutput: true, pdfInput: true, toolUse: false },
  // Spec 06 §6 (D-100): the tool loop, `tool-protocol-v1`. Each is its plain predecessor's reasoning
  // profile plus tools, replayed steps and mock results; only the tool loop sends them.
  'openai-responses-tool-loop-v1': { provider: 'openai', multiTurn: true, reasoning: 'off', structuredOutput: false, pdfInput: false, toolUse: true },
  'openai-responses-reasoning-low-tool-loop-v1': { provider: 'openai', multiTurn: true, reasoning: 'low', structuredOutput: false, pdfInput: false, toolUse: true },
  'anthropic-messages-tool-loop-v1': { provider: 'anthropic', multiTurn: true, reasoning: 'off', structuredOutput: false, pdfInput: false, toolUse: true },
  'anthropic-messages-between-tools-tool-loop-v1': { provider: 'anthropic', multiTurn: true, reasoning: 'off', structuredOutput: false, pdfInput: false, toolUse: true },
  'anthropic-messages-adaptive-low-tool-loop-v1': { provider: 'anthropic', multiTurn: true, reasoning: 'low', structuredOutput: false, pdfInput: false, toolUse: true },
  // Spec 07 §6.2 (D-108): Gemini's stateless `generateContent`, `store: false`. `minimal` is recorded as
  // `low` because Google says the model may still think, so it keeps the headroom. None of the three
  // sends structured output, a PDF or tools, and none has a successor, so `adapterVersionFor` refuses them.
  'google-generate-low-v1': { provider: 'google', multiTurn: true, reasoning: 'low', structuredOutput: false, pdfInput: false, toolUse: false },
  'google-generate-minimal-v1': { provider: 'google', multiTurn: true, reasoning: 'low', structuredOutput: false, pdfInput: false, toolUse: false },
  'google-generate-budget-off-v1': { provider: 'google', multiTurn: true, reasoning: 'off', structuredOutput: false, pdfInput: false, toolUse: false },
} as const satisfies Record<string, { provider: ProviderId; multiTurn: boolean; reasoning: ReasoningMode; structuredOutput: boolean; pdfInput: boolean; toolUse: boolean }>

/**
 * The version that adds structured output and PDF input to a plain version (spec 04 §6.4, D-86).
 * Plain hearings keep recording the plain version, so an older hearing's comparison never shows
 * an adapter change; a hearing that needs a feature records the successor.
 */
export const FEATURE_SUCCESSOR: Partial<Record<AdapterVersion, AdapterVersion>> = {
  'openai-responses-v2': 'openai-responses-v3',
  'openai-responses-reasoning-low-v1': 'openai-responses-reasoning-low-v2',
  'anthropic-messages-v2': 'anthropic-messages-v3',
  'anthropic-messages-between-tools-v1': 'anthropic-messages-between-tools-v2',
  'anthropic-messages-adaptive-low-v1': 'anthropic-messages-adaptive-low-v2',
}

/**
 * The tool-loop version of a plain version (spec 06 §6.1, D-100). As with `FEATURE_SUCCESSOR`, routes
 * keep their plain version; only a tool hearing records the tool-loop one.
 */
export const TOOL_SUCCESSOR: Partial<Record<AdapterVersion, AdapterVersion>> = {
  'openai-responses-v2': 'openai-responses-tool-loop-v1',
  'openai-responses-reasoning-low-v1': 'openai-responses-reasoning-low-tool-loop-v1',
  'anthropic-messages-v2': 'anthropic-messages-tool-loop-v1',
  'anthropic-messages-between-tools-v1': 'anthropic-messages-between-tools-tool-loop-v1',
  'anthropic-messages-adaptive-low-v1': 'anthropic-messages-adaptive-low-tool-loop-v1',
}

/** Provider-request features a hearing needs from its adapter version. */
export interface AdapterFeatures {
  structuredOutput?: boolean
  pdfInput?: boolean
  /** Spec 06: the tool loop. */
  toolUse?: boolean
}

/** The version a route records for a hearing with these features: itself, its successor, or null if none can carry them. */
export function adapterVersionFor(adapterVersion: string, features: AdapterFeatures): string | null {
  const profile = adapterProfile(adapterVersion)
  if (!profile) return null
  const fits = (p: (typeof ADAPTER_PROFILES)[AdapterVersion]) => (!features.structuredOutput || p.structuredOutput) && (!features.pdfInput || p.pdfInput) && (features.toolUse === true) === p.toolUse
  if (fits(profile)) return adapterVersion
  const next = (features.toolUse ? TOOL_SUCCESSOR : FEATURE_SUCCESSOR)[adapterVersion as AdapterVersion]
  return next && fits(ADAPTER_PROFILES[next]) ? next : null
}

export type AdapterVersion = keyof typeof ADAPTER_PROFILES

export const ADAPTER_VERSIONS = Object.keys(ADAPTER_PROFILES) as AdapterVersion[]

export function adapterProfile(version: string): (typeof ADAPTER_PROFILES)[AdapterVersion] | null {
  return Object.hasOwn(ADAPTER_PROFILES, version) ? ADAPTER_PROFILES[version as AdapterVersion] : null
}

export interface ModelRoute {
  key: string
  provider: ProviderId
  modelId: string
  /** The provider's display name, without the provider prefix ("GPT-6.2 Astra", "Claude Opus 5.5"). */
  label: string
  /** The provider's model line, for ordering and grouping ("GPT-6", "Opus"). */
  line: string
  /** Total context window in tokens, from the provider's model page. */
  contextTokens: number
  /** The provider's own maximum output per request. Hearings send far less (`LIMITS.maxOutputTokens`). */
  providerMaxOutputTokens: number
  reasoning: ReasoningMode
  /** The earliest retirement date the provider has announced, if any (ISO date). */
  retiresNotBefore: string | null
  /** The provider page this route's metadata was taken from. */
  docsUrl: string
  /** ISO date of the recorded live smoke call; null = documented but unverified. */
  verifiedAt: string | null
  /**
   * ISO date of a recorded live call with a multi-message history (D-39). Questions with a
   * conversation can run only on routes where this is set.
   */
  multiTurnVerifiedAt: string | null
  /**
   * ISO date of a recorded live structured-output call (`smoke:providers` mode `json`, spec 04
   * §6.5). Extraction hearings run only on routes where this is set. Documentation never sets it.
   */
  structuredVerifiedAt: string | null
  /** ISO date of a recorded live PDF call (mode `pdf`). Native-PDF questions need it. */
  pdfVerifiedAt: string | null
  /**
   * ISO date of a recorded live tool-loop call (`smoke:providers` mode `tools`, spec 06 §6.4): a
   * call, a result round trip and a final answer. Tool-use hearings run only on routes where this
   * is set. Documentation never sets it.
   */
  toolsVerifiedAt: string | null
  /** One of `ADAPTER_VERSIONS` (unit-tested); typed as a string because snapshots keep whatever they recorded. */
  adapterVersion: string
}

// Not bumped for spec 07 (D-108): the Gemini routes are additions and no existing route changed, as with
// items 4 and 6; a snapshot records only the routes it uses.
export const PROVIDER_REGISTRY_VERSION = '2026-11-17.3'

const OPENAI_DOCS = 'https://developers.openai.com/api/docs/models/'
const ANTHROPIC_DOCS = 'https://platform.claude.com/docs/en/about-claude/models/overview'
const GOOGLE_DOCS = 'https://aistudio.google.com/docs/models/'

/** GPT-6 and GPT-5.6 models share a 1,050,000-token window and a 128,000-token output limit. */
function openai(modelId: string, label: string, line: string, reasoning: ReasoningMode, extra: Partial<ModelRoute> = {}): ModelRoute {
  return {
    key: `openai-${modelId.replaceAll('.', '-')}`,
    provider: 'openai',
    modelId,
    label,
    line,
    contextTokens: 1_050_000,
    providerMaxOutputTokens: 128_000,
    reasoning,
    retiresNotBefore: null,
    docsUrl: OPENAI_DOCS + modelId,
    verifiedAt: null,
    multiTurnVerifiedAt: null,
    structuredVerifiedAt: null,
    pdfVerifiedAt: null,
    toolsVerifiedAt: null,
    adapterVersion: reasoning === 'low' ? 'openai-responses-reasoning-low-v1' : 'openai-responses-v2',
    ...extra,
  }
}

/** Current Claude models have a 1M-token window and a 128K-token synchronous output limit unless noted. */
function anthropic(modelId: string, label: string, line: string, adapterVersion: Extract<AdapterVersion, `anthropic-${string}`>, extra: Partial<ModelRoute> = {}): ModelRoute {
  return {
    key: `anthropic-${modelId}`,
    provider: 'anthropic',
    modelId,
    label,
    line,
    contextTokens: 1_000_000,
    providerMaxOutputTokens: 128_000,
    reasoning: ADAPTER_PROFILES[adapterVersion].reasoning,
    retiresNotBefore: null,
    docsUrl: ANTHROPIC_DOCS,
    verifiedAt: null,
    multiTurnVerifiedAt: null,
    structuredVerifiedAt: null,
    pdfVerifiedAt: null,
    toolsVerifiedAt: null,
    adapterVersion,
    ...extra,
  }
}

/**
 * Every Gemini route here has a 1,048,576-token window and a 65,536-token default synchronous output
 * limit (each model's page, read 2026-11-19). Model IDs come only from here (pattern unit-tested).
 */
function google(modelId: string, label: string, line: string, adapterVersion: Extract<AdapterVersion, `google-${string}`>, extra: Partial<ModelRoute> = {}): ModelRoute {
  return {
    key: `google-${modelId.replaceAll('.', '-')}`,
    provider: 'google',
    modelId,
    label,
    line,
    contextTokens: 1_048_576,
    providerMaxOutputTokens: 65_536,
    reasoning: ADAPTER_PROFILES[adapterVersion].reasoning,
    retiresNotBefore: null,
    docsUrl: GOOGLE_DOCS + modelId,
    verifiedAt: null,
    multiTurnVerifiedAt: null,
    structuredVerifiedAt: null,
    pdfVerifiedAt: null,
    toolsVerifiedAt: null,
    adapterVersion,
    ...extra,
  }
}

/**
 * Ordered by provider, then newest and most capable first within each line. Left out on
 * purpose (D-48): deprecated models, limited-access models (Claude Mythos, GPT-Rosalind),
 * Pro models that need background mode, open-weight models without default API access,
 * and `chat-latest`, which OpenAI says is not for API use.
 */
export const MODEL_ROUTES: readonly ModelRoute[] = [
  // OpenAI: reasoning effort `none` is accepted by Terra, Luna, GPT-6 Sol and every GPT-5.x model here;
  // GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Sol and GPT-6 Astra reject it (lowest is `low`).
  openai('gpt-6.2-astra', 'GPT-6.2 Astra', 'GPT-6', 'low'),
  openai('gpt-6.2-sol', 'GPT-6.2 Sol', 'GPT-6', 'low'),
  openai('gpt-6.1-terra', 'GPT-6.1 Terra', 'GPT-6', 'off'),
  openai('gpt-6.1-sol', 'GPT-6.1 Sol', 'GPT-6', 'low'),
  openai('gpt-6-astra', 'GPT-6 Astra', 'GPT-6', 'low'),
  openai('gpt-6-sol', 'GPT-6 Sol', 'GPT-6', 'off'),
  openai('gpt-6-luna', 'GPT-6 Luna', 'GPT-6', 'off', { verifiedAt: '2026-11-17' }),
  openai('gpt-5.6-sol', 'GPT-5.6 Sol', 'GPT-5', 'off'),
  openai('gpt-5.6-terra', 'GPT-5.6 Terra', 'GPT-5', 'off'),
  openai('gpt-5.6-luna', 'GPT-5.6 Luna', 'GPT-5', 'off'),
  openai('gpt-5.5', 'GPT-5.5', 'GPT-5', 'off'),
  openai('gpt-5.4', 'GPT-5.4', 'GPT-5', 'off'),
  openai('gpt-5.4-mini', 'GPT-5.4 mini', 'GPT-5', 'off', { contextTokens: 400_000 }),
  openai('gpt-5.2', 'GPT-5.2', 'GPT-5', 'off', { contextTokens: 400_000 }),

  // Anthropic: Fable and Opus 5.5 always think; Sonnet 5.5 turns up-front thinking off with
  // `between_tools`; every other model here accepts `thinking: {type: "disabled"}` at its default effort.
  anthropic('claude-fable-5-2', 'Claude Fable 5.2', 'Fable', 'anthropic-messages-adaptive-low-v1'),
  anthropic('claude-fable-5-1', 'Claude Fable 5.1', 'Fable', 'anthropic-messages-adaptive-low-v1'),
  anthropic('claude-fable-5', 'Claude Fable 5', 'Fable', 'anthropic-messages-adaptive-low-v1'),
  anthropic('claude-opus-5-5', 'Claude Opus 5.5', 'Opus', 'anthropic-messages-adaptive-low-v1'),
  anthropic('claude-opus-5', 'Claude Opus 5', 'Opus', 'anthropic-messages-v2'),
  anthropic('claude-opus-4-8', 'Claude Opus 4.8', 'Opus', 'anthropic-messages-v2'),
  anthropic('claude-opus-4-7', 'Claude Opus 4.7', 'Opus', 'anthropic-messages-v2'),
  anthropic('claude-opus-4-6', 'Claude Opus 4.6', 'Opus', 'anthropic-messages-v2'),
  anthropic('claude-opus-4-5-20251101', 'Claude Opus 4.5', 'Opus', 'anthropic-messages-v2', { contextTokens: 200_000, providerMaxOutputTokens: 64_000, retiresNotBefore: '2026-11-24' }),
  anthropic('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'Sonnet', 'anthropic-messages-between-tools-v1'),
  anthropic('claude-sonnet-5', 'Claude Sonnet 5', 'Sonnet', 'anthropic-messages-v2'),
  anthropic('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'Sonnet', 'anthropic-messages-v2'),
  anthropic('claude-haiku-5-5', 'Claude Haiku 5.5', 'Haiku', 'anthropic-messages-v2', { verifiedAt: '2026-11-17' }),
  anthropic('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 'Haiku', 'anthropic-messages-v2', { contextTokens: 200_000, providerMaxOutputTokens: 64_000, retiresNotBefore: '2026-10-15' }),

  // Google (spec 07 §6.2, D-108): stable text models only. Gemini 4 and 3.8 Flash cannot turn thinking
  // off (lowest level `low`); 3.6, 3.5 and 3.1 accept `minimal`; 2.5 Flash-Lite turns it off with
  // `thinkingBudget: 0` (optional, Q1). Left out: previews (they get shut down), the deprecated
  // gemini-2.5-flash and -pro (silently rerouted from Dec 1, 2026), and non-text models.
  google('gemini-4-carbon', 'Gemini 4 Carbon', 'Gemini 4', 'google-generate-low-v1'),
  google('gemini-4-argon', 'Gemini 4 Argon', 'Gemini 4', 'google-generate-low-v1'),
  google('gemini-4-neon', 'Gemini 4 Neon', 'Gemini 4', 'google-generate-low-v1'),
  google('gemini-4-hydrogen', 'Gemini 4 Hydrogen', 'Gemini 4', 'google-generate-low-v1'),
  google('gemini-3.8-flash', 'Gemini 3.8 Flash', 'Gemini 3', 'google-generate-low-v1'),
  google('gemini-3.6-flash', 'Gemini 3.6 Flash', 'Gemini 3', 'google-generate-minimal-v1'),
  google('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'Gemini 3', 'google-generate-minimal-v1'),
  google('gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', 'Gemini 3', 'google-generate-minimal-v1'),
  google('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'Gemini 2.5', 'google-generate-budget-off-v1'),
]

export function findRoute<R extends Pick<ModelRoute, 'key'>>(key: string, routes: readonly R[]): R | undefined
export function findRoute(key: string): ModelRoute | undefined
export function findRoute(key: string, routes: readonly Pick<ModelRoute, 'key'>[] = MODEL_ROUTES) {
  return routes.find((route) => route.key === key)
}

export function isRouteEnabled(route: Pick<ModelRoute, 'verifiedAt'>): boolean {
  return route.verifiedAt !== null
}

/** Routes grouped by provider in registry order, for pickers. */
export function routesByProvider<R extends Pick<ModelRoute, 'provider'>>(routes: readonly R[]): Array<{ provider: ProviderId; routes: R[] }> {
  return PROVIDERS.map((provider) => ({ provider, routes: routes.filter((route) => route.provider === provider) })).filter((group) => group.routes.length > 0)
}

/** Dated list prices for cost estimates (D-62); kept in their own module. */
export { callCostMicroUsd, PRICE_TABLE_VERSION, PRICE_TABLES, priceFor, priceTableFor, type PriceTable, type RoutePrice } from './prices'
