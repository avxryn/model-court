import type { ProviderId } from '../../domain/registry'
import { anthropicAdapter } from './anthropic'
import type { Adapter } from './common'
import { openAiAdapter } from './openai'

/** The only two transports. No generic proxy, base URL, or caller-chosen endpoint. */
export const ADAPTERS: Record<ProviderId, Adapter> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
}

/**
 * Dispatch by the adapter version a hearing recorded (D-39), so a retry uses the
 * version in its snapshot. v1 versions accept only a single user message.
 */
const VERSIONS: Record<string, { adapter: Adapter; multiTurn: boolean }> = {
  'openai-responses-v1': { adapter: openAiAdapter, multiTurn: false },
  'openai-responses-v2': { adapter: openAiAdapter, multiTurn: true },
  'anthropic-messages-v1': { adapter: anthropicAdapter, multiTurn: false },
  'anthropic-messages-v2': { adapter: anthropicAdapter, multiTurn: true },
}

export function adapterFor(adapterVersion: string, messageCount: number): Adapter | null {
  const entry = VERSIONS[adapterVersion]
  if (!entry) return null
  if (!entry.multiTurn && messageCount !== 1) return null
  return entry.adapter
}

export type { ProviderOutcome, ProviderErrorCode } from './common'
