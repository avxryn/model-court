import { ADAPTER_PROFILES, adapterProfile, type AdapterFeatures, type AdapterVersion, type ProviderId } from '../../domain/registry'
import { makeAnthropicAdapter } from './anthropic'
import type { Adapter } from './common'
import { makeOpenAiAdapter } from './openai'

export interface AdapterEntry {
  provider: ProviderId
  /** false: the version predates conversations (D-39) and accepts a single user message only. */
  multiTurn: boolean
  /** Spec 04 §6.4 (D-86): the version may send a structured-output schema / a PDF. */
  structuredOutput: boolean
  pdfInput: boolean
  /** Spec 06 (D-100): a tool-loop version; it has no single-call transport (`toolAdapterFor` sends it). */
  toolUse: boolean
  adapter: Adapter
}

/** The single-call slot of a tool-loop version: unreachable, because `adapterFor` refuses those versions first. */
const noSingleCall: Adapter = async () => ({ kind: 'failure', code: 'INVALID_PROVIDER_RESPONSE', definite: true, providerRequestId: null, durationMs: 0 })

const openAiNone = makeOpenAiAdapter('none')
const anthropicDisabled = makeAnthropicAdapter('disabled')

const transports: Record<AdapterVersion, Adapter> = {
  'openai-responses-v1': openAiNone,
  'openai-responses-v2': openAiNone,
  'openai-responses-reasoning-low-v1': makeOpenAiAdapter('low'),
  'anthropic-messages-v1': anthropicDisabled,
  'anthropic-messages-v2': anthropicDisabled,
  'anthropic-messages-between-tools-v1': makeAnthropicAdapter('between_tools'),
  'anthropic-messages-adaptive-low-v1': makeAnthropicAdapter('adaptive-low'),
  'openai-responses-v3': makeOpenAiAdapter('none', true),
  'openai-responses-reasoning-low-v2': makeOpenAiAdapter('low', true),
  'anthropic-messages-v3': makeAnthropicAdapter('disabled', true),
  'anthropic-messages-between-tools-v2': makeAnthropicAdapter('between_tools', true),
  'anthropic-messages-adaptive-low-v2': makeAnthropicAdapter('adaptive-low', true),
  'openai-responses-tool-loop-v1': noSingleCall,
  'openai-responses-reasoning-low-tool-loop-v1': noSingleCall,
  'anthropic-messages-tool-loop-v1': noSingleCall,
  'anthropic-messages-between-tools-tool-loop-v1': noSingleCall,
  'anthropic-messages-adaptive-low-tool-loop-v1': noSingleCall,
}

/**
 * Keyed by the adapter version a snapshot records (D-39, D-48), so a retry always sends the
 * body its hearing recorded. Only two fixed endpoints exist behind these entries; no generic
 * proxy, base URL, or caller-chosen endpoint.
 */
export const ADAPTERS: Readonly<Record<AdapterVersion, AdapterEntry>> = Object.fromEntries(
  (Object.keys(ADAPTER_PROFILES) as AdapterVersion[]).map((version) => [version, { provider: ADAPTER_PROFILES[version].provider, multiTurn: ADAPTER_PROFILES[version].multiTurn, structuredOutput: ADAPTER_PROFILES[version].structuredOutput, pdfInput: ADAPTER_PROFILES[version].pdfInput, toolUse: ADAPTER_PROFILES[version].toolUse, adapter: transports[version] }]),
) as Record<AdapterVersion, AdapterEntry>

/**
 * The transport for a recorded version, or null when the version is unknown, belongs to another
 * provider than the key about to be used (a key is never sent to another provider's endpoint),
 * cannot carry this many messages, or lacks a feature the request asks for (spec 04 §6.4): no send
 * and no charge, so a retry of an old hearing can never pick up a schema it never recorded.
 */
export function adapterFor(adapterVersion: string, provider: ProviderId, messageCount: number, features: AdapterFeatures = {}): Adapter | null {
  if (!adapterProfile(adapterVersion)) return null
  const entry = ADAPTERS[adapterVersion as AdapterVersion]
  if (entry.provider !== provider) return null
  // A tool-loop version is sent only step by step through `toolAdapterFor` (spec 06 §6.1).
  if (entry.toolUse) return null
  if (!entry.multiTurn && messageCount !== 1) return null
  if ((features.structuredOutput && !entry.structuredOutput) || (features.pdfInput && !entry.pdfInput)) return null
  return entry.adapter
}

export type { ProviderOutcome, ProviderErrorCode } from './common'
export { toolAdapterFor, type StepReplay, type ToolStepOutcome, type ToolStepRequest } from './tools'
