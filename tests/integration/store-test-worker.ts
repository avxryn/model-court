/**
 * Test-only Worker: exposes the production ModelCourtStore Durable Object over
 * HTTP so the integration suite can run against real Durable Object SQLite.
 * `?db=<name>` selects an isolated store instance per test harness.
 */
import { DurableObject } from 'cloudflare:workers'
import { migrateSync, MIGRATIONS } from '../../src/server/db/migrations'
import type { ModelCourtStore } from '../../src/server/db/store-object'
import type { StoreResult, StoreStatement } from '../../src/server/db/sql-batch-database'

export { ModelCourtStore } from '../../src/server/db/store-object'

const WRITE = /^\s*(insert|update|delete|replace)\b/i

/**
 * Test-only (D-65, D-106): the same Durable Object SQLite, migrated only up to the migration before
 * `heldBefore`, so a rebuild can be applied to a seeded store exactly as a deployed store would see
 * it. `migrateRest` then applies the remaining migrations.
 */
function heldStore(heldBefore: string) {
  return class extends DurableObject {
    constructor(ctx: DurableObjectState, env: unknown) {
      super(ctx, env as never)
      ctx.blockConcurrencyWhile(async () => {
        migrateSync(this.exec, (fn) => ctx.storage.transactionSync(fn), MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.id === heldBefore)))
      })
    }

    exec = (statement: string, ...params: Array<string | number>) => this.ctx.storage.sql.exec(statement, ...params).toArray() as Array<Record<string, unknown>>

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

    migrateRest(): string[] {
      return migrateSync(this.exec, (fn) => this.ctx.storage.transactionSync(fn))
    }
  }
}

export class PreSamplesStore extends heldStore('0009_generation_samples') {}
/** D-106: held before the provider CHECK rebuild. */
export class PreProvidersStore extends heldStore('0015_provider_google') {}

interface Env {
  STORE: DurableObjectNamespace<ModelCourtStore>
  PRE_SAMPLES_STORE: DurableObjectNamespace<PreSamplesStore>
  PRE_PROVIDERS_STORE: DurableObjectNamespace<PreProvidersStore>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const name = url.searchParams.get('db') ?? 'default'
    try {
      const held = { 'pre-samples': env.PRE_SAMPLES_STORE, 'pre-providers': env.PRE_PROVIDERS_STORE }[url.searchParams.get('store') ?? '']
      if (held) {
        const legacy = held.get(held.idFromName(name))
        if (url.searchParams.get('migrate') === 'rest') return Response.json(await legacy.migrateRest())
        return Response.json(await legacy.execute((await request.json()) as StoreStatement[]))
      }
      const stub = env.STORE.get(env.STORE.idFromName(name))
      const statements = (await request.json()) as StoreStatement[]
      return Response.json(await stub.execute(statements))
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
    }
  },
}
