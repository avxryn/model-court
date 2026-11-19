import { describe, expect, it, vi } from 'vitest'
import { PROVIDERS } from '../../domain/registry'
import { ANTHROPIC_MESSAGES_URL } from './anthropic'
import { allowlistedFetch, isOutboundRefused, outboundRefusal, PROVIDER_ORIGINS } from './endpoints'
import { KEY_CHECK_URLS } from './key-check'
import { adapterFor } from './index'
import { makeOpenAiAdapter, OPENAI_RESPONSES_URL } from './openai'

const manual = { redirect: 'manual' } as const

describe('outbound allowlist (spec 07 §6.5)', () => {
  it('lists one https origin per provider, and only those', () => {
    expect(Object.keys(PROVIDER_ORIGINS).sort()).toEqual([...PROVIDERS].sort())
    for (const origin of Object.values(PROVIDER_ORIGINS)) {
      expect(new URL(origin).origin).toBe(origin)
      expect(origin.startsWith('https://')).toBe(true)
    }
  })

  it('accepts the fixed endpoints, on any provider and on their own provider only', () => {
    expect(outboundRefusal(OPENAI_RESPONSES_URL, manual)).toBeNull()
    expect(outboundRefusal(OPENAI_RESPONSES_URL, manual, 'openai')).toBeNull()
    expect(outboundRefusal(ANTHROPIC_MESSAGES_URL, manual, 'anthropic')).toBeNull()
    expect(outboundRefusal(OPENAI_RESPONSES_URL, manual, 'anthropic')).toBe('wrong_provider')
    expect(outboundRefusal(ANTHROPIC_MESSAGES_URL, manual, 'openai')).toBe('wrong_provider')
    expect(outboundRefusal(new URL(OPENAI_RESPONSES_URL), manual)).toBeNull()
    expect(outboundRefusal(new Request(OPENAI_RESPONSES_URL, manual), undefined)).toBeNull()
  })

  it('refuses http, other hosts, look-alikes, userinfo, ports and anything but redirect: manual', () => {
    const cases: Array<[string, RequestInit | undefined, string]> = [
      ['http://api.openai.com/v1/responses', manual, 'not_https'],
      ['https://api.openai.com.evil.test/v1/responses', manual, 'origin'],
      ['https://evil.test/api.openai.com', manual, 'origin'],
      ['https://openai.com/v1/responses', manual, 'origin'],
      ['https://API.OPENAI.COM.evil.test/', manual, 'origin'],
      ['https://user:pass@api.openai.com/v1/responses', manual, 'userinfo'],
      ['https://user@api.openai.com/v1/responses', manual, 'userinfo'],
      ['https://api.openai.com:8443/v1/responses', manual, 'port'],
      ['https://api.openai.com:443/v1/responses', manual, 'port'],
      ['ftp://api.openai.com/', manual, 'not_https'],
      ['not a url', manual, 'unparseable'],
      [OPENAI_RESPONSES_URL, { redirect: 'follow' }, 'redirect'],
      [OPENAI_RESPONSES_URL, {}, 'redirect'],
      [OPENAI_RESPONSES_URL, undefined, 'redirect'],
    ]
    for (const [url, init, reason] of cases) expect(outboundRefusal(url, init), url).toBe(reason)
  })

  it('refuses before any network I/O, and logs fixed tokens only', async () => {
    const inner = vi.fn<typeof fetch>(async () => new Response('{}'))
    const log = vi.fn()
    const guarded = allowlistedFetch(inner, 'openai', log)
    const error = await guarded('https://api.openai.com.evil.test/v1/responses?key=secret', manual).catch((e: unknown) => e)
    expect(isOutboundRefused(error)).toBe(true)
    expect(inner).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith({ event: 'outbound_refused', reason: 'origin', provider: 'openai' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(log.mock.calls)).not.toContain('evil')
    await guarded(OPENAI_RESPONSES_URL, manual)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('an adapter whose URL the allowlist refuses records a definite, unsent PROVIDER_REJECTED_REQUEST', async () => {
    const inner = vi.fn<typeof fetch>(async () => new Response('{}'))
    const request = { modelId: 'm', system: 's', messages: [{ role: 'user' as const, content: 'u' }], maxOutputTokens: 16, apiKey: 'k', signal: new AbortController().signal }
    // An OpenAI transport handed a fetch narrowed to Anthropic: refused before any I/O.
    const outcome = await makeOpenAiAdapter('none')(allowlistedFetch(inner, 'anthropic'), request, new AbortController().signal)
    expect(outcome).toMatchObject({ kind: 'failure', code: 'PROVIDER_REJECTED_REQUEST', definite: true, unsent: true })
    expect(inner).not.toHaveBeenCalled()
    // adapterFor narrows to the version's own provider, so the right origin passes.
    const ok = await adapterFor('openai-responses-v2', 'openai', 1)!(inner, request, new AbortController().signal)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(ok.kind).toBe('failure') // the stub's '{}' is not a Responses body
  })

  it('every URL constant the adapters and the key check use has an allowlisted origin', () => {
    const urls = [OPENAI_RESPONSES_URL, ANTHROPIC_MESSAGES_URL, ...Object.values(KEY_CHECK_URLS)]
    for (const url of urls) expect(outboundRefusal(url, manual), url).toBeNull()
    for (const provider of PROVIDERS) expect(outboundRefusal(KEY_CHECK_URLS[provider], manual, provider), provider).toBeNull()
  })

  it('no provider module spells out a host: every origin comes from PROVIDER_ORIGINS', () => {
    const sources = import.meta.glob(['./*.ts', '!./*.test.ts', '!./endpoints.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(sources).length).toBeGreaterThan(3)
    for (const [name, text] of Object.entries(sources)) expect(text, name).not.toMatch(/https?:\/\//)
  })
})
