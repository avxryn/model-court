/**
 * ModelCourtStore — the authoritative relational store (replaces managed D1,
 * which DeepSpace's free tier does not allow; docs/decisions.md D-20).
 *
 * One app-wide SQLite-backed Durable Object. Every `execute` call runs inside
 * `transactionSync`: if any statement fails (including a guard CHECK), every
 * statement in the call rolls back. Durable Objects process calls one at a
 * time, so batches are serialized exactly like D1's single-writer model.
 * Only the Worker holds the binding; there is no client route to this object.
 *
 * The object applies its own migrations before serving any call, so callers
 * never need a shared, cached handle (D-22).
 */

import { DurableObject } from 'cloudflare:workers'
import { migrateSync } from './migrations'
import type { StoreResult, StoreStatement } from './sql-batch-database'

const WRITE = /^\s*(insert|update|delete|replace)\b/i

export class ModelCourtStore extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql
      migrateSync(
        (statement, ...params) => sql.exec(statement, ...params).toArray() as Array<Record<string, unknown>>,
        (fn) => ctx.storage.transactionSync(fn),
      )
    })
  }

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

/**
 * A stub for the single store instance. Create one per request, job, or cron
 * run: Durable Object stubs are I/O objects bound to the context that created
 * them and must never be cached across contexts (D-22).
 */
export function storeStub(namespace: DurableObjectNamespace<ModelCourtStore>) {
  return namespace.get(namespace.idFromName('model-court-store'))
}
