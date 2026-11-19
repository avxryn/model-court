import { describe, expect, it } from 'vitest'
import { ADAPTER_PROFILES, ADAPTER_VERSIONS, adapterProfile, findRoute, isRouteEnabled, MODEL_ROUTES, PROVIDERS, routesByProvider } from './registry'
import { modelConfigurationSchema } from './contracts'

describe('model registry (D-48)', () => {
  it('has unique keys and one route per provider model', () => {
    const keys = MODEL_ROUTES.map((route) => route.key)
    expect(new Set(keys).size).toBe(keys.length)
    const models = MODEL_ROUTES.map((route) => `${route.provider}:${route.modelId}`)
    expect(new Set(models).size).toBe(models.length)
    for (const route of MODEL_ROUTES) {
      expect(route.key.startsWith(`${route.provider}-`)).toBe(true)
      expect(modelConfigurationSchema.shape.modelKey.safeParse(route.key).success).toBe(true)
    }
  })

  it('records a known adapter version for its own provider, with matching reasoning metadata', () => {
    for (const route of MODEL_ROUTES) {
      const profile = adapterProfile(route.adapterVersion)
      expect(profile, route.key).not.toBeNull()
      expect(profile!.provider, route.key).toBe(route.provider)
      expect(profile!.reasoning, route.key).toBe(route.reasoning)
      // Every current route can carry a conversation; only its live check is pending.
      expect(profile!.multiTurn, route.key).toBe(true)
    }
  })

  it('keeps honest limits: a positive context window and the provider output cap above the hearing cap', () => {
    for (const route of MODEL_ROUTES) {
      expect(route.contextTokens).toBeGreaterThan(0)
      expect(route.providerMaxOutputTokens).toBeGreaterThan(8_192 + 512)
      expect(route.docsUrl).toMatch(/^https:\/\/(developers\.openai\.com|platform\.claude\.com|aistudio\.google\.com)\//)
      expect(route.label).not.toMatch(/^(OpenAI|Anthropic|Google) /)
    }
  })

  it('keeps the routes earlier drafts and snapshots name', () => {
    expect(findRoute('openai-gpt-6-luna')).toMatchObject({ provider: 'openai', modelId: 'gpt-6-luna', adapterVersion: 'openai-responses-v2' })
    expect(findRoute('anthropic-claude-haiku-5-5')).toMatchObject({ provider: 'anthropic', modelId: 'claude-haiku-5-5', adapterVersion: 'anthropic-messages-v2' })
    for (const version of ['openai-responses-v1', 'openai-responses-v2', 'anthropic-messages-v1', 'anthropic-messages-v2']) expect(adapterProfile(version)).not.toBeNull()
    expect(adapterProfile('toString')).toBeNull()
    expect(adapterProfile('made-up-v9')).toBeNull()
  })

  it('enables only routes with a recorded live call (docs/provider-contracts.md)', () => {
    // Documentation never verifies a route. Add a key here only with its smoke-record row.
    expect(MODEL_ROUTES.filter(isRouteEnabled).map((route) => route.key)).toEqual(['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
  })

  it('maps the models that cannot turn reasoning off to the low-effort versions', () => {
    const low = MODEL_ROUTES.filter((route) => route.reasoning === 'low').map((route) => route.modelId)
    expect(low).toEqual(['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'gemini-4-carbon', 'gemini-4-argon', 'gemini-4-neon', 'gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'])
    expect(findRoute('anthropic-claude-sonnet-5-5')?.adapterVersion).toBe('anthropic-messages-between-tools-v1')
  })

  it('groups routes by provider in registry order', () => {
    const groups = routesByProvider(MODEL_ROUTES)
    expect(groups.map((group) => group.provider)).toEqual([...PROVIDERS])
    expect(groups.flatMap((group) => group.routes)).toHaveLength(MODEL_ROUTES.length)
    expect(groups[0].routes[0].modelId).toBe('gpt-6.2-astra')
    expect(routesByProvider(MODEL_ROUTES.filter((route) => route.provider === 'anthropic')).map((group) => group.provider)).toEqual(['anthropic'])
  })

  it('lists the nine Gemini routes of spec 07 §6.2, unverified, on Google versions without features (D-108)', () => {
    const google = MODEL_ROUTES.filter((route) => route.provider === 'google')
    expect(google.map((route) => [route.key, route.modelId, route.adapterVersion])).toEqual([
      ['google-gemini-4-carbon', 'gemini-4-carbon', 'google-generate-low-v1'],
      ['google-gemini-4-argon', 'gemini-4-argon', 'google-generate-low-v1'],
      ['google-gemini-4-neon', 'gemini-4-neon', 'google-generate-low-v1'],
      ['google-gemini-4-hydrogen', 'gemini-4-hydrogen', 'google-generate-low-v1'],
      ['google-gemini-3-8-flash', 'gemini-3.8-flash', 'google-generate-low-v1'],
      ['google-gemini-3-6-flash', 'gemini-3.6-flash', 'google-generate-minimal-v1'],
      ['google-gemini-3-5-flash-lite', 'gemini-3.5-flash-lite', 'google-generate-minimal-v1'],
      ['google-gemini-3-1-flash-lite', 'gemini-3.1-flash-lite', 'google-generate-minimal-v1'],
      ['google-gemini-2-5-flash-lite', 'gemini-2.5-flash-lite', 'google-generate-budget-off-v1'],
    ])
    for (const route of google) {
      expect(route.modelId, route.key).toMatch(/^[a-z0-9][a-z0-9.-]*$/)
      expect(route.docsUrl).toBe(`https://aistudio.google.com/docs/models/${route.modelId}`)
      for (const field of ['verifiedAt', 'multiTurnVerifiedAt', 'structuredVerifiedAt', 'pdfVerifiedAt', 'toolsVerifiedAt'] as const) expect(route[field], `${route.key} ${field}`).toBeNull()
      const profile = adapterProfile(route.adapterVersion)!
      expect([profile.structuredOutput, profile.pdfInput, profile.toolUse], route.key).toEqual([false, false, false])
    }
    // Previews get shut down; deprecated 2.5 models are silently rerouted from 2026-12-01.
    for (const denied of ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash', 'gemini-2.5-pro']) {
      expect(MODEL_ROUTES.some((route) => route.modelId === denied), denied).toBe(false)
    }
    expect(MODEL_ROUTES.some((route) => /preview|-image|tts|live|robotics/.test(route.modelId))).toBe(false)
  })

  it('lists every adapter version once', () => {
    expect(ADAPTER_VERSIONS).toEqual(Object.keys(ADAPTER_PROFILES))
  })
})
