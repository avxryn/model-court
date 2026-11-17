import { ADAPTER_PROFILES, adapterProfile, type AdapterVersion, type ProviderId } from '../../domain/registry'
import { makeAnthropicAdapter } from './anthropic'
import type { Adapter } from './common'
import { makeOpenAiAdapter } from './openai'

export interface AdapterEntry {
  provider: ProviderId
  /** false: the version predates conversations (D-39) and accepts a single user message only. */
  multiTurn: boolean
  adapter: Adapter
}

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
}

/**
 * Keyed by the adapter version a snapshot records (D-39, D-48), so a retry always sends the
 * body its hearing recorded. Only two fixed endpoints exist behind these entries; no generic
 * proxy, base URL, or caller-chosen endpoint.
 */
export const ADAPTERS: Readonly<Record<AdapterVersion, AdapterEntry>> = Object.fromEntries(
  (Object.keys(ADAPTER_PROFILES) as AdapterVersion[]).map((version) => [version, { provider: ADAPTER_PROFILES[version].provider, multiTurn: ADAPTER_PROFILES[version].multiTurn, adapter: transports[version] }]),
) as Record<AdapterVersion, AdapterEntry>

/**
 * The transport for a recorded version, or null when the version is unknown, belongs to another
 * provider than the key about to be used (a key is never sent to another provider's endpoint),
 * or cannot carry this many messages.
 */
export function adapterFor(adapterVersion: string, provider: ProviderId, messageCount: number): Adapter | null {
  if (!adapterProfile(adapterVersion)) return null
  const entry = ADAPTERS[adapterVersion as AdapterVersion]
  if (entry.provider !== provider) return null
  if (!entry.multiTurn && messageCount !== 1) return null
  return entry.adapter
}

export type { ProviderOutcome, ProviderErrorCode } from './common'
