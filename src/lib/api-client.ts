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
  const token = await getAuthToken()
  if (!token) throw new ApiClientError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
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

export function describeError(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  return 'Something went wrong.'
}
