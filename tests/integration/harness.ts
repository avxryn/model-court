/**
 * Integration harness: the real /api/v1 Hono app, real services and SQL, a
 * real local D1 (wrangler getPlatformProxy → workerd SQLite), and real ES256 JWT verification via
 * the SDK's `verifyJwt`. Only external boundaries are substituted:
 *   - the platform auth issuer (test-generated signing key),
 *   - the DeepSpace JobRoom queue (in-memory list, drained explicitly),
 *   - DeepSpace notices (recorded),
 *   - provider HTTP (`providerFetch` stub — no paid calls are possible).
 * A passing test here is NOT evidence that a real provider call works.
 */

import { Hono } from 'hono'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy, unstable_dev, type Unstable_DevWorker } from 'wrangler'
import { SqlBatchDatabase } from '../../src/server/db/sql-batch-database'
import { verifyJwt } from 'deepspace/worker'
import type { KitTable } from '../../src/domain/kits/registry'
import { MODEL_ROUTES, PRICE_TABLES, type ModelRoute, type PriceTable } from '../../src/domain/registry'
import { createApi } from '../../src/server/api'
import { parseConfig, type ConfigEnv } from '../../src/server/config'
import { ensureMigrated, migrate, MIGRATIONS } from '../../src/server/db/migrations'
import type { Deps, GenerationJob, ToolStepJob } from '../../src/server/deps'
import { handleGenerationJob, type JobOutcome } from '../../src/server/services/generation'
import { handleGradingJob, type GradingJob } from '../../src/server/services/special-master'
import { handleToolStepJob } from '../../src/server/services/tool-loop'

const ISSUER = 'https://auth.model-court.test'

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url')
}

export function randomKeyB64(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
}

export interface ProviderCall {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export type ProviderStub = (call: ProviderCall, signal: AbortSignal) => Promise<Response>

export const openAiOk = (text = 'Returns are accepted within 30 days with a receipt.') =>
  new Response(
    JSON.stringify({
      id: 'resp_test',
      status: 'completed',
      model: 'gpt-6-luna',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
      usage: { input_tokens: 120, output_tokens: 24 },
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_openai_test' } },
  )

export const anthropicOk = (text = 'Yes — the policy allows returns within 30 days with a receipt.') =>
  new Response(
    JSON.stringify({ id: 'msg_test', type: 'message', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 130, output_tokens: 20 } }),
    { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_anthropic_test' } },
  )

export const okStub: ProviderStub = async (call) => (call.url.includes('openai') ? openAiOk() : anthropicOk())

/**
 * Storage under test. Default: local D1 (wrangler getPlatformProxy).
 * MC_STORE=do: the production ModelCourtStore Durable Object (SQLite), one
 * isolated instance per harness, served by tests/integration/store-test-worker.ts.
 */
let storeWorker: Promise<Unstable_DevWorker> | null = null

async function openDatabase(): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
  if (process.env.MC_STORE === 'do') {
    storeWorker ??= unstable_dev(fileURLToPath(new URL('./store-test-worker.ts', import.meta.url)), {
      config: fileURLToPath(new URL('./wrangler.store-test.toml', import.meta.url)),
      experimental: { disableExperimentalWarning: true },
      logLevel: 'error',
    })
    const worker = await storeWorker
    const name = crypto.randomUUID()
    const db = new SqlBatchDatabase(async (statements) => {
      const response = await worker.fetch(`http://store/?db=${name}`, { method: 'POST', body: JSON.stringify(statements) })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'store error')
      return body as never
    }).asD1()
    return { db, dispose: async () => {} }
  }
  // persist: false → a fresh in-memory local D1 per harness.
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'tests/integration/wrangler.test.toml', persist: false })
  return { db: proxy.env.DB, dispose: () => proxy.dispose() }
}

/** Test-only stores held at an older schema, by the first migration they have not applied (store-test-worker.ts). */
const HELD_STORES = { '0009_generation_samples': 'pre-samples', '0015_provider_google': 'pre-providers' } as const
export type HeldBefore = keyof typeof HELD_STORES

/**
 * D-65, D-106: a store held at the schema before `migrationId`, on whichever store is under test, for
 * seeding legacy rows with SQL and then applying the remaining migrations.
 */
export async function openDatabaseBefore(migrationId: HeldBefore): Promise<{ db: D1Database; migrateRest: () => Promise<string[]>; dispose: () => Promise<void> }> {
  const before = MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.id === migrationId))
  if (process.env.MC_STORE === 'do') {
    storeWorker ??= unstable_dev(fileURLToPath(new URL('./store-test-worker.ts', import.meta.url)), {
      config: fileURLToPath(new URL('./wrangler.store-test.toml', import.meta.url)),
      experimental: { disableExperimentalWarning: true },
      logLevel: 'error',
    })
    const worker = await storeWorker
    const name = crypto.randomUUID()
    const store = HELD_STORES[migrationId]
    const db = new SqlBatchDatabase(async (statements) => {
      const response = await worker.fetch(`http://store/?store=${store}&db=${name}`, { method: 'POST', body: JSON.stringify(statements) })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'store error')
      return body as never
    }).asD1()
    const migrateRest = async () => {
      const response = await worker.fetch(`http://store/?store=${store}&db=${name}&migrate=rest`, { method: 'POST', body: '[]' })
      const body = (await response.json()) as string[] | { error: string }
      if (!response.ok) throw new Error((body as { error: string }).error)
      return body as string[]
    }
    // Force the object to start (and migrate up to the held migration) before the caller seeds it.
    await db.prepare('SELECT 1').first()
    return { db, migrateRest, dispose: async () => {} }
  }
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'tests/integration/wrangler.test.toml', persist: false })
  await migrate(proxy.env.DB, before)
  return { db: proxy.env.DB, migrateRest: () => migrate(proxy.env.DB), dispose: () => proxy.dispose() }
}

/** D-65: a store held at the schema before `0009_generation_samples`. */
export const openPreSamplesDatabase = () => openDatabaseBefore('0009_generation_samples')

export interface HarnessOptions {
  env?: Partial<ConfigEnv>
  routes?: readonly ModelRoute[]
  priceTables?: readonly PriceTable[]
  /** Spec 03 (D-76): a kit table to inject, e.g. a test-only kit with a trivial or throwing check. */
  kits?: KitTable
}

export async function createHarness(options: HarnessOptions = {}) {
  const { db, dispose } = await openDatabase()
  await migrate(db)

  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', signing.publicKey)).toString('base64')
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`

  let clock = Date.UTC(2026, 10, 18, 15, 0, 0)
  const jobs: GenerationJob[] = []
  const gradingJobs: GradingJob[] = []
  const toolStepJobs: ToolStepJob[] = []
  const notices: Array<{ recipientUserId: string; evaluationId: string; runId: string | null }> = []
  const logs: Array<Record<string, unknown>> = []
  const providerCalls: ProviderCall[] = []
  let providerStub: ProviderStub = okStub
  let enqueueFails = false

  const env: ConfigEnv = {
    DEEPSPACE_APP_ID: 'app_test',
    GENERATION_ENABLED: 'true',
    CREDENTIAL_ACTIVE_KEY_VERSION: 'v1',
    CREDENTIAL_ENCRYPTION_KEY_V1: randomKeyB64(),
    CREDENTIAL_REQUEST_HMAC_KEY: randomKeyB64(),
    PUBLIC_APP_ORIGIN: 'https://model-court.test',
    APP_COMMIT: 'test-commit',
    ...options.env,
  }

  const providerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const call = { url, headers, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> }
    providerCalls.push(call)
    if (init?.redirect !== 'manual') throw new Error('Adapters must refuse redirects')
    return providerStub(call, init?.signal ?? new AbortController().signal)
  }) as typeof fetch

  let idCounter = 0
  const deps: Deps = {
    db,
    ensureSchema: () => ensureMigrated(db),
    get config() {
      return parseConfig(env)
    },
    routes: options.routes ?? MODEL_ROUTES.map((route) => ({ ...route, verifiedAt: '2026-11-16', multiTurnVerifiedAt: '2026-11-16', structuredVerifiedAt: '2026-11-16', pdfVerifiedAt: '2026-11-16', toolsVerifiedAt: '2026-11-16' })),
    priceTables: options.priceTables ?? PRICE_TABLES,
    now: () => clock,
    newId: () => {
      idCounter++
      return crypto.randomUUID()
    },
    verifyToken: async (token) => {
      const { result } = await verifyJwt({ publicKey: publicKeyPem, issuer: ISSUER }, token)
      return result ? { userId: result.userId, name: null } : null
    },
    enqueueGeneration: async (job) => {
      if (enqueueFails) throw new Error('enqueue unavailable')
      jobs.push(job)
      return `job_${jobs.length}`
    },
    enqueueGrading: async (job) => {
      if (enqueueFails) throw new Error('enqueue unavailable')
      gradingJobs.push(job)
      return `grade_${gradingJobs.length}`
    },
    enqueueToolStep: async (job) => {
      if (enqueueFails) throw new Error('enqueue unavailable')
      toolStepJobs.push(job)
      return `step_${toolStepJobs.length}`
    },
    publishNotices: async (batch) => {
      notices.push(...batch)
    },
    purgeNotices: async () => {},
    providerFetch,
    log: (event) => logs.push(event),
    ...(options.kits ? { kits: options.kits } : {}),
  } as Deps

  const app = new Hono()
  app.route('/api/v1', createApi(() => deps))

  async function token(userId: string, expiresInSeconds = 3600): Promise<string> {
    const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })))
    const now = Math.floor(Date.now() / 1000)
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ sub: userId, iss: ISSUER, iat: now, exp: now + expiresInSeconds })))
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signing.privateKey, new TextEncoder().encode(`${header}.${payload}`))
    return `${header}.${payload}.${b64url(signature)}`
  }

  interface RequestOptions {
    as?: string | null
    body?: unknown
    ifMatch?: number
    idempotencyKey?: string | false
    headers?: Record<string, string>
    rawToken?: string
  }

  async function request<T = any>(method: string, path: string, opts: RequestOptions = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    if (opts.rawToken) headers.Authorization = `Bearer ${opts.rawToken}`
    else if (opts.as) headers.Authorization = `Bearer ${await token(opts.as)}`
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.ifMatch !== undefined) headers['If-Match'] = `"${opts.ifMatch}"`
    if (opts.idempotencyKey !== false && method !== 'GET' && method !== 'PUT' && method !== 'DELETE') {
      headers['Idempotency-Key'] = opts.idempotencyKey ?? crypto.randomUUID()
    }
    const response = await app.request(`https://model-court.test/api/v1${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = new TextDecoder().decode(bytes) // drops a leading BOM, like response.text()
    const isJson = (response.headers.get('Content-Type') ?? 'application/json').includes('json')
    return { status: response.status, json: (text && isJson ? JSON.parse(text) : null) as T, headers: response.headers, text, bytes }
  }

  async function drainJobs(signal: AbortSignal = new AbortController().signal): Promise<JobOutcome[]> {
    const outcomes: JobOutcome[] = []
    // Spec 06: a tool step's commit enqueues the next step, so drain until both queues are empty.
    while (jobs.length > 0 || toolStepJobs.length > 0) {
      const job = jobs.shift()
      if (job) outcomes.push(await handleGenerationJob(deps, job, signal, 'req_job_test'))
      const step = toolStepJobs.shift()
      if (step) outcomes.push(await handleToolStepJob(deps, step, signal, 'req_step_test'))
    }
    while (gradingJobs.length > 0) {
      const job = gradingJobs.shift()!
      outcomes.push(await handleGradingJob(deps, job, signal, 'req_grade_test'))
    }
    return outcomes
  }

  return {
    db,
    deps,
    env,
    app,
    jobs,
    gradingJobs,
    toolStepJobs,
    notices,
    logs,
    providerCalls,
    token,
    request,
    drainJobs,
    setProvider: (stub: ProviderStub) => {
      providerStub = stub
    },
    setEnqueueFails: (fails: boolean) => {
      enqueueFails = fails
    },
    advance: (ms: number) => {
      clock += ms
    },
    now: () => clock,
    get idCount() {
      return idCounter
    },
    dispose,
  }
}

export type Harness = Awaited<ReturnType<typeof createHarness>>

export const OWNER = 'user_owner_1'
export const REVIEWER = 'user_reviewer_2'
export const OTHER = 'user_unrelated_3'

/** Owner saves both provider keys and creates an evaluation with the seeded draft. */
export async function setupOwner(h: Harness, user = OWNER) {
  const openai = await h.request('POST', '/credentials', { as: user, body: { provider: 'openai', label: 'Test OpenAI', apiKey: 'sk-test-SENTINEL-OPENAI-KEY', consentToStorage: true } })
  const anthropic = await h.request('POST', '/credentials', { as: user, body: { provider: 'anthropic', label: 'Test Anthropic', apiKey: 'sk-ant-SENTINEL-ANTHROPIC-KEY', consentToStorage: true } })
  const evaluation = await h.request('POST', '/evaluations', { as: user, body: { title: 'Support policy QA', taskDescription: 'Reference-grounded support answers' } })
  return { openaiKeyId: openai.json.data.id as string, anthropicKeyId: anthropic.json.data.id as string, evaluationId: evaluation.json.data.id as string, draft: evaluation.json.data.draft }
}

/**
 * Deliberation opens by itself once every answer is in. Open it by hand
 * (acknowledging exclusions) only when it did not, and return the
 * open-review fields either way; `automatic` says which happened.
 */
export async function openDeliberation(h: Harness, runId: string, user = OWNER) {
  const view = (await h.request('GET', `/runs/${runId}`, { as: user })).json.data
  if (view.status === 'reviewing') {
    return {
      runId,
      status: 'reviewing',
      revision: view.revision as number,
      eligibleCaseCount: view.eligibility.caseKeys.length as number,
      excludedCaseCount: view.eligibility.excludedCaseKeys.length as number,
      ownerSessionId: view.review.ownerSessionId as string,
      automatic: true,
    }
  }
  const opened = await h.request('POST', `/runs/${runId}/open-review`, { as: user, ifMatch: view.revision, body: { acknowledgeExcludedCases: true } })
  if (opened.status !== 200) throw new Error(`open-review failed: ${opened.status} ${JSON.stringify(opened.json)}`)
  return { ...opened.json.data, automatic: false } as { runId: string; status: string; revision: number; eligibleCaseCount: number; excludedCaseCount: number; ownerSessionId: string; automatic: boolean }
}

export async function startRun(h: Harness, setup: Awaited<ReturnType<typeof setupOwner>>, user = OWNER, idempotencyKey?: string) {
  return h.request('POST', `/evaluations/${setup.evaluationId}/runs`, {
    as: user,
    idempotencyKey,
    body: { draftRevision: 1, credentialIdsByProvider: { openai: setup.openaiKeyId, anthropic: setup.anthropicKeyId }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
  })
}
