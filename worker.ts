/**
 * App Worker — DeepSpace platform wiring plus the Model Court API.
 *
 * Registration order is part of the worker contract: specific API and
 * WebSocket handlers precede the SPA fallback. The scaffold's Durable Object
 * classes are all retained (removing a class requires a data-deleting
 * migration); only the routes Model Court needs are exposed.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { armCronRoom, CanvasRoom, CronRoom, JobRoom, PresenceRoom, RecordRoom, workerErrorHandler, YjsRoom } from 'deepspace/worker'
import type { DOBindings, DOManifest, Job, JobContext } from 'deepspace/worker'
import { tasks as cronTasks, runTask as runCronTask } from './src/cron.js'
import { runJob } from './src/jobs.js'
import { schemas } from './src/schemas.js'
import { createApi } from './src/server/api.js'
import type { ConfigEnv } from './src/server/config.js'
import { parseConfig } from './src/server/config.js'
import { registerAuthRoutes, registerStaticRoutes } from './src/server/http-routes.js'
import { platformDeps } from './src/server/platform.js'
import { registerRealtimeRoutes } from './src/server/realtime-routes.js'

export { ModelCourtStore } from './src/server/db/store-object.js'

// Dynamic deploy reads this manifest to create the app's DO bindings.
export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
  { binding: 'CRON_ROOMS', className: 'AppCronRoom', sqlite: true },
  { binding: 'JOB_ROOMS', className: 'AppJobRoom', sqlite: true },
  // Model Court's authoritative relational store (SQLite Durable Object; D-20).
  { binding: 'MODEL_COURT_STORE', className: 'ModelCourtStore', sqlite: true },
] as const satisfies DOManifest

export class AppRecordRoom extends RecordRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }
}

export class AppYjsRoom extends YjsRoom<Env> {}
export class AppCanvasRoom extends CanvasRoom<Env> {}
export class AppPresenceRoom extends PresenceRoom<Env> {}

/** Runs the scheduled repair task defined in src/cron.ts. */
export class AppCronRoom extends CronRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tasks: cronTasks })
  }

  protected async onTask(taskName: string): Promise<void> {
    await runCronTask(taskName, this.env)
  }
}

/**
 * Durable generation jobs. Client sockets can neither read nor write the queue
 * (spec V4): only the Worker enqueues, through the internal `/enqueue` path
 * used by `enqueueJob`, after the API has authorized and budgeted the work.
 */
export class AppJobRoom extends JobRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      defaultMaxAttempts: 1,
      authorizeWrite: () => false,
      authorizeRead: () => false,
    })
  }

  protected async onJob(job: Job, context: JobContext): Promise<unknown> {
    return await runJob(job, context, this.env)
  }
}

export interface Env extends DOBindings<typeof __DO_MANIFEST__>, ConfigEnv {
  ASSETS: Fetcher
  PLATFORM_WORKER?: Fetcher
  PLATFORM_WORKER_URL?: string
  APP_IDENTITY_TOKEN?: string
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  NATIVE_AUTH_REDIRECT_URIS?: string
  APP_NAME: string
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
  APP_OWNER_JWT: string
  ALLOW_DEBUG_ROUTES?: string
}

export type AppContext = { Bindings: Env }

const app = new Hono<AppContext>()

// Security headers (spec §9.5). The CSP allows the platform auth worker and
// same-origin sockets; no wildcard connect sources and no framing.
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('X-Frame-Options', 'DENY')
  const contentType = c.res.headers.get('content-type') ?? ''
  // Vite dev injects inline preamble scripts; production builds contain none (verified), so the
  // strict CSP is applied to every non-dev response.
  if (contentType.includes('text/html') && !import.meta.env.DEV) {
    const auth = (() => {
      try {
        return new URL(c.env.AUTH_WORKER_URL).origin
      } catch {
        return ''
      }
    })()
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        `connect-src 'self' wss: ${auth}`.trim(),
        "frame-ancestors 'none'",
        "base-uri 'self'",
        `form-action 'self' ${auth}`.trim(),
      ].join('; '),
    )
  }
})

// Auth proxy CORS is kept from the scaffold; the Model Court API is same-origin only.
app.use('/api/auth/*', cors())

// A Durable Object exists only once something fetches it, and the CronRoom
// arms its alarm in that first fetch — so wake it from the request path.
app.use('*', async (c, next) => {
  armCronRoom(c.executionCtx, c.env.CRON_ROOMS, `app:${c.env.DEEPSPACE_APP_ID}`, cronTasks)
  await next()
})

// Public readiness: build id and a boolean only — no secrets or provider config.
app.get('/healthz', async (c) => {
  const config = parseConfig(c.env)
  let storeOk = false
  try {
    storeOk = (await platformDeps(c.env).db.prepare('SELECT 1 AS ok').first<{ ok: number }>())?.ok === 1
  } catch {
    storeOk = false
  }
  return c.json(
    { build: config.appCommit, ready: config.problems.length === 0 && storeOk, storeOk, generationEnabled: config.generationEnabled },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

app.route('/api/v1', createApi((c) => platformDeps(c.env as Env)))
registerAuthRoutes(app)
registerRealtimeRoutes(app)
registerStaticRoutes(app)

app.onError(workerErrorHandler('error'))

export default app
