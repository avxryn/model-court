import { describe, expect, it } from 'vitest'
import { ANTHROPIC_VERSION } from './anthropic'
import { checkProviderKey, classifyKeyCheckStatus, KEY_CHECK_URLS } from './key-check'

const KEY = 'sk-test-SENTINEL-CHECK-KEY'

function recordingFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return respond()
  }) as typeof fetch
  return { fetchFn, calls }
}

describe('checkProviderKey (mocked provider, no network)', () => {
  it('makes one GET to the fixed OpenAI list-models endpoint with bearer auth and refuses redirects', async () => {
    const { fetchFn, calls } = recordingFetch(() => new Response('{"data":[]}', { status: 200 }))
    const outcome = await checkProviderKey(fetchFn, 'openai', KEY)
    expect(outcome).toEqual({ result: 'valid', reason: 'OK', httpStatus: 200 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(KEY_CHECK_URLS.openai)
    expect(calls[0].url).toBe('https://api.openai.com/v1/models')
    expect(calls[0].init.method).toBe('GET')
    expect(calls[0].init.redirect).toBe('manual')
    expect(calls[0].init.body).toBeUndefined()
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
  })

  it('uses x-api-key and the pinned API version for Anthropic', async () => {
    const { fetchFn, calls } = recordingFetch(() => new Response('{}', { status: 200 }))
    await checkProviderKey(fetchFn, 'anthropic', KEY)
    expect(calls[0].url.startsWith('https://api.anthropic.com/v1/models')).toBe(true)
    expect(calls[0].init.headers).toEqual({ 'x-api-key': KEY, 'anthropic-version': ANTHROPIC_VERSION })
  })

  it('reports a rejected key as invalid', async () => {
    const { fetchFn } = recordingFetch(() => new Response(`{"error":{"message":"Incorrect API key provided: ${KEY}"}}`, { status: 401 }))
    const outcome = await checkProviderKey(fetchFn, 'openai', KEY)
    expect(outcome).toEqual({ result: 'invalid', reason: 'AUTH_FAILED', httpStatus: 401 })
    expect(JSON.stringify(outcome)).not.toContain('SENTINEL')
  })

  it('Google: one GET to the fixed list-models URL, key in x-goog-api-key, never in the URL (spec 07 §6.6)', async () => {
    const { fetchFn, calls } = recordingFetch(() => new Response('{"models":[]}', { status: 200 }))
    expect(await checkProviderKey(fetchFn, 'google', KEY)).toEqual({ result: 'valid', reason: 'OK', httpStatus: 200 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1')
    expect(calls[0].url).not.toContain(KEY)
    expect(calls[0].url).not.toMatch(/key=/)
    expect(calls[0].init.headers).toEqual({ 'x-goog-api-key': KEY })
    expect(calls[0].init.redirect).toBe('manual')
  })

  it('Google: 401 is invalid and 403 restricted', async () => {
    expect(await checkProviderKey(recordingFetch(() => new Response('{"error":{"code":"authentication"}}', { status: 401 })).fetchFn, 'google', KEY)).toEqual({ result: 'invalid', reason: 'AUTH_FAILED', httpStatus: 401 })
    expect(await checkProviderKey(recordingFetch(() => new Response('{}', { status: 403 })).fetchFn, 'google', KEY)).toEqual({ result: 'restricted', reason: 'ACCESS_DENIED', httpStatus: 403 })
  })

  it('Google: a 400 is invalid only with the API_KEY_INVALID/EXPIRED reason token, read from at most 4 KiB', async () => {
    const legacy = (reason: string, pad = '') => JSON.stringify({ error: { code: 400, message: `API key not valid. ${KEY} SENTINEL-MESSAGE${pad}`, status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] } })
    for (const reason of ['API_KEY_INVALID', 'API_KEY_EXPIRED']) {
      const outcome = await checkProviderKey(recordingFetch(() => new Response(legacy(reason), { status: 400 })).fetchFn, 'google', KEY)
      expect(outcome).toEqual({ result: 'invalid', reason: 'AUTH_FAILED', httpStatus: 400 })
      expect(JSON.stringify(outcome)).not.toContain('SENTINEL')
    }
    expect(await checkProviderKey(recordingFetch(() => new Response(legacy('SOMETHING_ELSE'), { status: 400 })).fetchFn, 'google', KEY)).toEqual({ result: 'unreachable', reason: 'UNEXPECTED_STATUS', httpStatus: 400 })
    expect(await checkProviderKey(recordingFetch(() => new Response('not json API_KEY_INVALID', { status: 400 })).fetchFn, 'google', KEY)).toEqual({ result: 'unreachable', reason: 'UNEXPECTED_STATUS', httpStatus: 400 })
    // The token only in the 4 KiB message tail is never read.
    const long = legacy('API_KEY_INVALID', 'x'.repeat(5000))
    expect(await checkProviderKey(recordingFetch(() => new Response(long, { status: 400 })).fetchFn, 'google', KEY)).toEqual({ result: 'unreachable', reason: 'UNEXPECTED_STATUS', httpStatus: 400 })
    // The message alone never counts.
    expect(await checkProviderKey(recordingFetch(() => new Response(JSON.stringify({ error: { message: 'API_KEY_INVALID' } }), { status: 400 })).fetchFn, 'google', KEY)).toMatchObject({ result: 'unreachable' })
  })

  it('OpenAI and Anthropic 400s still never read the body', async () => {
    let read = false
    const body = new ReadableStream({ pull() { read = true } }, { highWaterMark: 0 })
    expect(await checkProviderKey(recordingFetch(() => new Response(body, { status: 400 })).fetchFn, 'openai', KEY)).toMatchObject({ result: 'unreachable', reason: 'UNEXPECTED_STATUS' })
    expect(read).toBe(false)
  })

  it('reports a network failure as unreachable and drops the error text', async () => {
    const fetchFn = (async () => {
      throw new TypeError(`connect ECONNREFUSED while sending ${KEY}`)
    }) as typeof fetch
    const outcome = await checkProviderKey(fetchFn, 'anthropic', KEY)
    expect(outcome).toEqual({ result: 'unreachable', reason: 'NETWORK_ERROR', httpStatus: null })
    expect(JSON.stringify(outcome)).not.toContain('SENTINEL')
  })

  it('reports a timeout as unreachable', async () => {
    const fetchFn = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    expect(await checkProviderKey(fetchFn, 'openai', KEY, 20)).toEqual({ result: 'unreachable', reason: 'TIMEOUT', httpStatus: null })
  })

  it.each([
    [403, 'restricted', 'ACCESS_DENIED'],
    [429, 'unreachable', 'RATE_LIMITED'],
    [500, 'unreachable', 'PROVIDER_ERROR'],
    [503, 'unreachable', 'PROVIDER_ERROR'],
    [302, 'unreachable', 'REDIRECT_REFUSED'],
    [400, 'unreachable', 'UNEXPECTED_STATUS'],
  ])('classifies HTTP %i as %s', (status, result, reason) => {
    expect(classifyKeyCheckStatus(status)).toMatchObject({ result, reason, httpStatus: status })
  })
})
