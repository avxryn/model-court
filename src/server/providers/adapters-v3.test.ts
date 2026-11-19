/**
 * Spec 04 §6.4 (D-86): the structured-output and PDF adapter versions. Without features each
 * body is byte-identical to its predecessor's; with them the bodies below are pinned.
 */

import { describe, expect, it } from 'vitest'
import { compileWireSchema } from '../../domain/extraction/schema'
import { EXTRACTION_STARTERS } from '../../domain/extraction/starters'
import { LIMITS } from '../../domain/limits'
import { ADAPTER_PROFILES, ADAPTER_VERSIONS, adapterVersionFor, FEATURE_SUCCESSOR, MODEL_ROUTES, type AdapterVersion } from '../../domain/registry'
import type { ProviderRequest } from './common'
import { featureRejection } from './common'
import { adapterFor } from './index'

const never = new AbortController().signal
const schema = compileWireSchema(EXTRACTION_STARTERS[1].schema)
const responseFormat = { name: 'extraction' as const, schema }
const document = { mediaType: 'application/pdf' as const, base64: 'JVBERi0xLjQK' }

function request(extra: Partial<ProviderRequest> = {}): ProviderRequest {
  return { modelId: 'm', system: 's', messages: [{ role: 'user', content: 'u' }], maxOutputTokens: LIMITS.extraction.maxOutputTokens, apiKey: 'test-key', signal: never, ...extra }
}

function capture(reply: unknown, status = 200) {
  const sent: string[] = []
  const fetchFn = (async (_url: string, init: RequestInit) => {
    sent.push(init.body as string)
    return new Response(JSON.stringify(reply), { status })
  }) as unknown as typeof fetch
  return { sent, fetchFn }
}

const openAiReply = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"fullName":"A"}' }] }], usage: { input_tokens: 3, output_tokens: 4 } }
const anthropicReply = { content: [{ type: 'text', text: '{"fullName":"A"}' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 4 } }
const replyFor = (version: string) => (ADAPTER_PROFILES[version as AdapterVersion].provider === 'openai' ? openAiReply : anthropicReply)

async function bodyOf(version: string, extra: Partial<ProviderRequest> = {}): Promise<string> {
  const { sent, fetchFn } = capture(replyFor(version))
  const profile = ADAPTER_PROFILES[version as AdapterVersion]
  const adapter = adapterFor(version, profile.provider, 1)!
  const outcome = await adapter(fetchFn, request(extra), never)
  expect(outcome.kind).toBe('success')
  return sent[0]
}

const SUCCESSORS = Object.entries(FEATURE_SUCCESSOR) as Array<[AdapterVersion, AdapterVersion]>

describe('feature adapter versions', () => {
  it('there are exactly the five successors of spec 04 §6.4, each with both features', () => {
    expect(SUCCESSORS.map(([, next]) => next).sort()).toEqual(['anthropic-messages-adaptive-low-v2', 'anthropic-messages-between-tools-v2', 'anthropic-messages-v3', 'openai-responses-reasoning-low-v2', 'openai-responses-v3'])
    for (const [old, next] of SUCCESSORS) {
      expect(ADAPTER_PROFILES[next]).toEqual({ ...ADAPTER_PROFILES[old], structuredOutput: true, pdfInput: true })
      expect(ADAPTER_PROFILES[old].structuredOutput).toBe(false)
    }
  })

  it('without features each body is byte-identical to its predecessor', async () => {
    for (const [old, next] of SUCCESSORS) {
      expect(await bodyOf(next), next).toBe(await bodyOf(old))
      expect(await bodyOf(next, { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }), next).toBe(
        await (async () => {
          const { sent, fetchFn } = capture(replyFor(old))
          await adapterFor(old, ADAPTER_PROFILES[old].provider, 3)!(fetchFn, request({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }), never)
          return sent[0]
        })(),
      )
    }
  })

  it('older versions never send a feature, even if one reaches the transport', async () => {
    for (const [old] of SUCCESSORS) {
      expect(await bodyOf(old, { responseFormat, document })).toBe(await bodyOf(old))
    }
  })

  it('adapterFor refuses a feature a version lacks (no send, no charge)', () => {
    for (const version of ADAPTER_VERSIONS) {
      const profile = ADAPTER_PROFILES[version]
      expect(adapterFor(version, profile.provider, 1, { structuredOutput: true }) !== null).toBe(profile.structuredOutput)
      expect(adapterFor(version, profile.provider, 1, { pdfInput: true }) !== null).toBe(profile.pdfInput)
    }
  })

  it('every route has a successor that carries both features', () => {
    // Spec 07 (D-108): Gemini routes have none, so extraction hearings refuse them.
    for (const route of MODEL_ROUTES) expect(adapterVersionFor(route.adapterVersion, { structuredOutput: true, pdfInput: true }), route.key).toBe(route.provider === 'google' ? null : FEATURE_SUCCESSOR[route.adapterVersion as AdapterVersion])
    expect(adapterVersionFor('openai-responses-v1', { structuredOutput: true })).toBeNull()
    expect(adapterVersionFor('openai-responses-v2', {})).toBe('openai-responses-v2')
    expect(adapterVersionFor('nope', {})).toBeNull()
  })
})

describe('golden bodies with features', () => {
  it('OpenAI: input_file first, strict json_schema, 2,048 (+ headroom on low)', async () => {
    const none = JSON.parse(await bodyOf('openai-responses-v3', { responseFormat, document }))
    expect(none).toEqual({
      model: 'm',
      instructions: 's',
      input: [{ role: 'user', content: [{ type: 'input_file', filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQK' }, { type: 'input_text', text: 'u' }] }],
      text: { format: { type: 'json_schema', name: 'extraction', strict: true, schema } },
      max_output_tokens: 2048,
      reasoning: { effort: 'none' },
      store: false,
    })
    expect(Object.keys(none)).toEqual(['model', 'instructions', 'input', 'text', 'max_output_tokens', 'reasoning', 'store'])
    const low = JSON.parse(await bodyOf('openai-responses-reasoning-low-v2', { responseFormat }))
    expect(low).toEqual({ ...none, input: [{ role: 'user', content: [{ type: 'input_text', text: 'u' }] }], max_output_tokens: 2048 + LIMITS.reasoningHeadroomTokens, reasoning: { effort: 'low' } })
  })

  it('Anthropic: document block first, output_config.format, merged with effort on adaptive-low', async () => {
    const disabled = JSON.parse(await bodyOf('anthropic-messages-v3', { responseFormat, document }))
    expect(disabled).toEqual({
      model: 'm',
      max_tokens: 2048,
      system: 's',
      messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' } }, { type: 'text', text: 'u' }] }],
      thinking: { type: 'disabled' },
      output_config: { format: { type: 'json_schema', schema } },
    })
    const between = JSON.parse(await bodyOf('anthropic-messages-between-tools-v2', { responseFormat }))
    expect(between).toEqual({ ...disabled, messages: [{ role: 'user', content: 'u' }], thinking: { type: 'between_tools' } })
    const adaptive = JSON.parse(await bodyOf('anthropic-messages-adaptive-low-v2', { responseFormat }))
    expect(adaptive).toEqual({
      model: 'm',
      max_tokens: 2048 + LIMITS.reasoningHeadroomTokens,
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    })
    expect(JSON.stringify(adaptive)).not.toContain('output_format')
  })

  it('only the document goes in a PDF request, never a file name or URL', async () => {
    for (const [, next] of SUCCESSORS) {
      const body = await bodyOf(next, { document })
      expect(body).not.toContain('file_url')
      expect(body).not.toContain('file_id')
    }
  })
})

describe('feature error codes (documented 400 messages)', () => {
  it('names a refused schema or an unreadable PDF; anything else stays a rejected request', async () => {
    expect(featureRejection(400, 'Schema is too complex for compilation', { responseFormat })).toBe('PROVIDER_SCHEMA_REJECTED')
    expect(featureRejection(400, "Invalid schema for response_format 'extraction': ...", { responseFormat })).toBe('PROVIDER_SCHEMA_REJECTED')
    expect(featureRejection(400, 'A maximum of 100 PDF pages may be provided.', { document })).toBe('PROVIDER_DOCUMENT_REJECTED')
    expect(featureRejection(400, 'The PDF is encrypted.', { document, responseFormat })).toBe('PROVIDER_DOCUMENT_REJECTED')
    expect(featureRejection(400, 'Schema is too complex for compilation', {})).toBeNull()
    expect(featureRejection(400, 'max_tokens is too large', { responseFormat, document })).toBeNull()
    expect(featureRejection(429, 'Schema is too complex', { responseFormat })).toBeNull()
    const { fetchFn } = capture({ type: 'error', error: { type: 'invalid_request_error', message: 'Schema is too complex for compilation' } }, 400)
    expect(await adapterFor('anthropic-messages-v3', 'anthropic', 1)!(fetchFn, request({ responseFormat }), never)).toMatchObject({ kind: 'failure', code: 'PROVIDER_SCHEMA_REJECTED', definite: true })
    const openAi = capture({ error: { message: 'The file document.pdf could not be read as a PDF.', type: 'invalid_request_error' } }, 400)
    expect(await adapterFor('openai-responses-v3', 'openai', 1)!(openAi.fetchFn, request({ document }), never)).toMatchObject({ kind: 'failure', code: 'PROVIDER_DOCUMENT_REJECTED', definite: true })
    const old = capture({ type: 'error', error: { type: 'invalid_request_error', message: 'Schema is too complex for compilation' } }, 400)
    expect(await adapterFor('anthropic-messages-v2', 'anthropic', 1)!(old.fetchFn, request(), never)).toMatchObject({ code: 'PROVIDER_REJECTED_REQUEST' })
  })
})
