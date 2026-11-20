/**
 * D-118: the browser checks readiness with the catalog's models. Before, it blanked their adapter
 * version, so every extraction and tool-use draft showed "can't call mock tools" / "can't return
 * answers as fields" for OpenAI and Anthropic models the server would accept. The catalog now
 * carries each route's adapter version, and the browser-side check agrees with the server's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeExampleDraft } from '../../src/domain/example'
import type { ModelRoute } from '../../src/domain/registry'
import { readinessIssues } from '../../src/domain/snapshot'
import { EXAMPLE_TOOL_TASK } from '../../src/domain/tools/task'
import { createHarness, OWNER, type Harness } from './harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.dispose()
})

let n = 0
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

describe('readiness from the catalog (D-118)', () => {
  it('sends each route’s adapter version, so a tool-use draft on OpenAI and Anthropic is not refused as unsupported', async () => {
    const catalog = (await h.request('GET', '/catalog', { as: OWNER })).json.data as { models: Array<ModelRoute & { enabled: boolean }> }
    for (const model of catalog.models) expect(typeof model.adapterVersion, model.key).toBe('string')
    // Exactly what the case page builds from the catalog.
    const routes = catalog.models.map((model) => ({ ...model })) as ModelRoute[]
    const draft = makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
    const tools = {
      ...draft,
      kit: { version: 'tools-v1', settings: {} },
      cases: draft.cases.slice(0, 1).map((c) => ({ ...c, reference: '', kitFields: { kind: 'tools' as const, ...EXAMPLE_TOOL_TASK } })),
    }
    const browser = readinessIssues(tools as never, routes)
    expect(browser.filter((issue) => issue.kind === 'feature_unsupported')).toEqual([])
    // The same answer as the server's own routes.
    expect(browser.map((issue) => issue.kind)).toEqual(readinessIssues(tools as never, h.deps.routes).map((issue) => issue.kind))
  })
})
