/**
 * Shared HTTP contract for /api/v1 (spec §6.1): envelopes, normalized errors,
 * body caps, and the Idempotency-Key / If-Match headers.
 */

import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'
import { LIMITS } from '../domain/limits'

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INCOMPLETE_REVIEW'
  | 'INVITE_UNAVAILABLE'
  | 'ACTIVE_RUN_EXISTS'
  | 'PAYLOAD_TOO_LARGE'
  | 'VALIDATION_FAILED'
  /** Spec 07 §8.2: an API key pasted on another provider's card. */
  | 'KEY_PROVIDER_MISMATCH'
  | 'UNSUPPORTED_CONFIGURATION'
  | 'CREDENTIAL_MISSING'
  | 'REVISION_REQUIRED'
  | 'QUOTA_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'GENERATION_DISABLED'
  | 'CREDENTIAL_WRITES_DISABLED'
  | 'NOT_READY'
  | 'INTERNAL'

export interface FieldIssue {
  path: string
  message: string
}

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly options: { retryable?: boolean; fields?: FieldIssue[]; retryAfterSeconds?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message)
  }
}

export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Not found.')
export const forbidden = (message = 'You do not have permission for this action.') => new ApiError(403, 'FORBIDDEN', message)
export const stateConflict = (message: string, details?: Record<string, unknown>) =>
  new ApiError(409, 'STATE_CONFLICT', message, { details })
export const revisionConflict = () =>
  new ApiError(409, 'REVISION_CONFLICT', 'This item changed. Reload before saving.')

export function requestIdOf(c: Context): string {
  let id = c.get('requestId' as never) as string | undefined
  if (!id) {
    id = `req_${crypto.randomUUID()}`
    c.set('requestId' as never, id as never)
  }
  return id
}

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' }

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200, headers: Record<string, string> = {}) {
  return c.json({ data, requestId: requestIdOf(c) }, status, { ...PRIVATE_HEADERS, ...headers })
}

export function noContent(c: Context) {
  return c.body(null, 204, PRIVATE_HEADERS)
}

export function errorResponse(c: Context, error: ApiError) {
  const headers: Record<string, string> = { ...PRIVATE_HEADERS }
  if (error.options.retryAfterSeconds !== undefined) headers['Retry-After'] = String(error.options.retryAfterSeconds)
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.options.retryable ?? false,
        ...(error.options.fields ? { fields: error.options.fields } : {}),
        ...(error.options.details ? { details: error.options.details } : {}),
      },
      requestId: requestIdOf(c),
    },
    error.status,
    headers,
  )
}

/** Read a JSON body with a byte cap, then validate it strictly. */
export async function readBody<S extends z.ZodType>(c: Context, schema: S, maxBytes: number = LIMITS.requestBodyBytes): Promise<z.output<S>> {
  const declared = Number(c.req.header('Content-Length') ?? '0')
  if (declared > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
  let json: unknown
  try {
    json = bytes.byteLength === 0 ? {} : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Malformed JSON.')
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    // A schema may give an issue its own error code (spec 07 §8.2 `KEY_PROVIDER_MISMATCH`); the message is the issue's own fixed text.
    const coded = parsed.error.issues.find((issue) => issue.code === 'custom' && (issue as { params?: { apiCode?: unknown } }).params?.apiCode === 'KEY_PROVIDER_MISMATCH')
    if (coded) throw new ApiError(422, 'KEY_PROVIDER_MISMATCH', coded.message, { fields })
    throw new ApiError(422, 'VALIDATION_FAILED', 'Some fields are invalid.', { fields })
  }
  return parsed.data
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function idempotencyKey(c: Context): string {
  const key = c.req.header('Idempotency-Key')
  if (!key || !UUID.test(key)) throw new ApiError(400, 'BAD_REQUEST', 'A UUID Idempotency-Key header is required.')
  return key.toLowerCase()
}

/** If-Match: "<revision>" — required for revision-guarded commands (428 when missing). */
export function ifMatchRevision(c: Context): number {
  const header = c.req.header('If-Match')
  if (!header) throw new ApiError(428, 'REVISION_REQUIRED', 'An If-Match revision header is required.')
  const match = /^"?(\d{1,9})"?$/.exec(header.trim())
  if (!match) throw new ApiError(400, 'BAD_REQUEST', 'If-Match must be a quoted revision number.')
  return Number(match[1])
}

export function pathId(c: Context, name: string): string {
  const value = c.req.param(name)
  if (!value || !UUID.test(value)) throw notFound()
  return value.toLowerCase()
}
