import type { ProviderId } from '../../domain/registry'
import { anthropicAdapter } from './anthropic'
import type { Adapter } from './common'
import { openAiAdapter } from './openai'

/** The only two transports. No generic proxy, base URL, or caller-chosen endpoint. */
export const ADAPTERS: Record<ProviderId, Adapter> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
}

export type { ProviderOutcome, ProviderErrorCode } from './common'
