/**
 * Idempotency receipts (spec §4.5, §6.1). A command stores its response in
 * the same batch as its mutation; a duplicate key replays it, a different
 * payload under the same key is IDEMPOTENCY_CONFLICT. Callers authorize the
 * actor before replaying, so a revoked participant receives 404, not a replay.
 */

import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { canonicalJson, sha256Hex } from '../domain/canonical'
import { LIMITS } from '../domain/limits'
import { classifyConstraint } from './db/sql'
import type { Deps } from './deps'
import { ApiError } from './http'

export interface ReceiptKey {
  actorUserId: string
  idempotencyKey: string
  operation: string
  requestHash: string
}

export interface CommandResult<T> {
  status: ContentfulStatusCode
  data: T
}

export async function requestHash(operation: string, payload: unknown): Promise<string> {
  return sha256Hex(canonicalJson({ operation, payload }))
}

async function findReceipt(db: D1Database, key: ReceiptKey, now: number) {
  return db
    .prepare(
      `SELECT operation, request_hash, http_status, response_json FROM command_receipts
       WHERE actor_user_id = ? AND idempotency_key = ? AND expires_at > ?`,
    )
    .bind(key.actorUserId, key.idempotencyKey, now)
    .first<{ operation: string; request_hash: string; http_status: number; response_json: string }>()
}

function replay(row: { operation: string; request_hash: string; http_status: number; response_json: string }, key: ReceiptKey) {
  if (row.operation !== key.operation || row.request_hash !== key.requestHash) {
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different request.')
  }
  return { status: row.http_status as ContentfulStatusCode, data: JSON.parse(row.response_json) as unknown }
}

export type ReceiptWriter = (result: CommandResult<unknown>, entityId: string | null, storedData?: unknown) => D1PreparedStatement

/**
 * Run `execute` at most once per (actor, key). `execute` must include the
 * statement returned by `receipt(...)` in its guarded batch. `storedData`
 * lets a command persist a redacted response (invite secrets are never stored).
 */
export async function idempotent<T>(
  deps: Deps,
  key: ReceiptKey,
  execute: (receipt: ReceiptWriter) => Promise<CommandResult<T>>,
): Promise<CommandResult<T | unknown> & { replayed: boolean }> {
  const now = deps.now()
  const existing = await findReceipt(deps.db, key, now)
  if (existing) return { ...replay(existing, key), replayed: true }

  const receipt: ReceiptWriter = (result, entityId, storedData) =>
    deps.db
      .prepare(
        `INSERT INTO command_receipts (actor_user_id, idempotency_key, operation, request_hash, entity_id, http_status, response_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        key.actorUserId,
        key.idempotencyKey,
        key.operation,
        key.requestHash,
        entityId,
        result.status,
        JSON.stringify(storedData ?? result.data),
        now,
        now + LIMITS.receiptTtlMs,
      )

  try {
    return { ...(await execute(receipt)), replayed: false }
  } catch (error) {
    // A concurrent duplicate may have committed first. Its effects can make our
    // own guard fail before the receipt conflict is reached, so check on any error.
    const winner = await findReceipt(deps.db, key, now)
    if (winner) return { ...replay(winner, key), replayed: true }
    if (classifyConstraint(error) === 'receipt') throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'A concurrent request with this key is still in progress.', { retryable: true })
    throw error
  }
}
