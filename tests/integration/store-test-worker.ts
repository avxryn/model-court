/**
 * Test-only Worker: exposes the production ModelCourtStore Durable Object over
 * HTTP so the integration suite can run against real Durable Object SQLite.
 * `?db=<name>` selects an isolated store instance per test harness.
 */
import { storeStub, type ModelCourtStore } from '../../src/server/db/store-object'
import type { StoreStatement } from '../../src/server/db/sql-batch-database'

export { ModelCourtStore } from '../../src/server/db/store-object'

interface Env {
  STORE: DurableObjectNamespace<ModelCourtStore>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const name = new URL(request.url).searchParams.get('db') ?? 'default'
    const stub = env.STORE.get(env.STORE.idFromName(name))
    try {
      const statements = (await request.json()) as StoreStatement[]
      return Response.json(await stub.execute(statements))
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
    }
  },
}
