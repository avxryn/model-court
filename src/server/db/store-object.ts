/**
 * ModelCourtStore — the authoritative relational store (replaces managed D1,
 * which DeepSpace's free tier does not allow; docs/decisions.md D-20).
 *
 * One app-wide SQLite-backed Durable Object. Every `execute` call runs inside
 * `transactionSync`: if any statement fails (including a guard CHECK), every
 * statement in the call rolls back. Durable Objects process calls one at a
 * time, so batches are serialized exactly like D1's single-writer model.
 * Only the Worker holds the binding; there is no client route to this object.
 */

import { DurableObject } from 'cloudflare:workers'
import type { StoreResult, StoreStatement } from './sql-batch-database'

const WRITE = /^\s*(insert|update|delete|replace)\b/i

export class ModelCourtStore extends DurableObject {
  execute(statements: StoreStatement[]): StoreResult[] {
    const sql = this.ctx.storage.sql
    return this.ctx.storage.transactionSync(() =>
      statements.map((statement) => {
        const rows = sql.exec(statement.sql, ...statement.params).toArray() as Record<string, unknown>[]
        const changes = WRITE.test(statement.sql) ? Number(sql.exec('SELECT changes() AS c').one().c) : 0
        return { rows, changes }
      }),
    )
  }
}

/** The single store instance for this app. */
export function storeStub(namespace: DurableObjectNamespace<ModelCourtStore>) {
  return namespace.get(namespace.idFromName('model-court-store'))
}
