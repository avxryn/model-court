/**
 * Verified direct-generation routes (spec §6.4). Browser-safe: model metadata only.
 *
 * A route is selectable only after a real authorized call has been recorded in
 * docs/provider-contracts.md and `verifiedAt` is set here. Until then the
 * catalog lists it as unavailable and run admission rejects it (F04).
 */

export const PROVIDERS = ['openai', 'anthropic'] as const
export type ProviderId = (typeof PROVIDERS)[number]

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
}

export interface ModelRoute {
  key: string
  provider: ProviderId
  modelId: string
  label: string
  /** ISO date of the recorded live smoke call; null = documented but unverified. */
  verifiedAt: string | null
  adapterVersion: string
}

export const PROVIDER_REGISTRY_VERSION = '2026-11-16.1'

export const MODEL_ROUTES: readonly ModelRoute[] = [
  {
    key: 'openai-gpt-6-luna',
    provider: 'openai',
    modelId: 'gpt-6-luna',
    label: 'OpenAI GPT-6 Luna',
    verifiedAt: null,
    adapterVersion: 'openai-responses-v1',
  },
  {
    key: 'anthropic-claude-haiku-5-5',
    provider: 'anthropic',
    modelId: 'claude-haiku-5-5',
    label: 'Anthropic Claude Haiku 5.5',
    verifiedAt: null,
    adapterVersion: 'anthropic-messages-v1',
  },
]

export function findRoute(
  key: string,
  routes: readonly ModelRoute[] = MODEL_ROUTES,
): ModelRoute | undefined {
  return routes.find((route) => route.key === key)
}

export function isRouteEnabled(route: ModelRoute): boolean {
  return route.verifiedAt !== null
}
