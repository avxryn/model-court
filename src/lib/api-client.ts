/**
 * Typed client for the Model Court /api/v1 routes and error normalization.
 * The platform JWT comes only from the SDK's supported flow; it is never
 * logged or stored by this module.
 */

import { getAuthToken } from 'deepspace'

export interface FieldIssue {
  path: string
  message: string
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldIssue[] = [],
    readonly details: Record<string, unknown> = {},
    readonly requestId: string | null = null,
  ) {
    super(message)
  }

  get isConflict() {
    return this.status === 409
  }
}

export interface RequestOptions {
  body?: unknown
  /** Entity revision for If-Match. */
  revision?: number
  /** A UUID identifying this logical user decision; reuse it only for transport retries. */
  idempotencyKey?: string
  signal?: AbortSignal
}

export function newIntentKey(): string {
  return crypto.randomUUID()
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, options: RequestOptions = {}): Promise<T> {
  // No token is not an error here: a guest juror's HttpOnly cookie (D-41) may authorize the request; the server decides.
  const token = await getAuthToken().catch(() => null)
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.revision !== undefined) headers['If-Match'] = `"${options.revision}"`
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: 'no-store',
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiClientError(0, 'NETWORK', 'Could not reach Model Court. Check your connection and try again.')
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  let payload: { data?: T; error?: { code: string; message: string; fields?: FieldIssue[]; details?: Record<string, unknown> }; requestId?: string } = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiClientError(response.status, 'BAD_RESPONSE', 'The server returned an unexpected response.')
  }
  if (!response.ok || payload.error) {
    const error = payload.error ?? { code: 'HTTP_ERROR', message: `Request failed (${response.status}).` }
    throw new ApiClientError(response.status, error.code, error.message, error.fields ?? [], error.details ?? {}, payload.requestId ?? null)
  }
  return payload.data as T
}

/** Spec 04 (D-90): PUT a PDF as raw bytes with its page count; the reply is the normal JSON envelope. */
export async function apiUploadPdf<T>(path: string, bytes: ArrayBuffer, pageCount: number, revision: number): Promise<T> {
  const token = await getAuthToken().catch(() => null)
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      method: 'PUT',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/pdf', 'If-Match': `"${revision}"`, 'X-Page-Count': String(pageCount) },
      body: bytes,
      cache: 'no-store',
    })
  } catch {
    throw new ApiClientError(0, 'NETWORK', 'Could not reach Model Court. Check your connection and try again.')
  }
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string; fields?: FieldIssue[]; details?: Record<string, unknown> }; requestId?: string }
  if (!response.ok || payload.error) {
    const error = payload.error ?? { code: 'HTTP_ERROR', message: `Request failed (${response.status}).` }
    throw new ApiClientError(response.status, error.code, error.message, error.fields ?? [], error.details ?? {}, payload.requestId ?? null)
  }
  return payload.data as T
}

/** GET a non-JSON body (e.g. a CSV export) with the bearer token; errors use the normal JSON envelope. */
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const token = await getAuthToken().catch(() => null)
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
  } catch {
    throw new ApiClientError(0, 'NETWORK', 'Could not reach Model Court. Check your connection and try again.')
  }
  if (!response.ok) {
    let payload: { error?: { code: string; message: string }; requestId?: string } = {}
    try {
      payload = await response.json()
    } catch {
      // fall through to the generic message
    }
    throw new ApiClientError(response.status, payload.error?.code ?? 'HTTP_ERROR', payload.error?.message ?? `Request failed (${response.status}).`, [], {}, payload.requestId ?? null)
  }
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null
  return { blob: await response.blob(), filename }
}

/** Hand a blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.documentElement.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function describeError(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  return 'Something went wrong.'
}
