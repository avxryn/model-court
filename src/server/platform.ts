/**
 * Production wiring of the service boundaries to DeepSpace primitives:
 * platform JWT verification, JobRoom (`enqueueJob`), RecordRoom notices, and
 * Worker `fetch` for the two fixed provider endpoints.
 */

import { appFiles, enqueueJob, verifyJwt, type AppFilesEnv } from 'deepspace/worker'
import { MODEL_ROUTES, PRICE_TABLES } from '../domain/registry'
import { NOTICES_COLLECTION } from '../schemas/notices-schema'
import type { Env } from '../../worker'
import { parseConfig } from './config'
import type { Deps } from './deps'
import { GENERATION_JOB_TYPE } from './services/generation'
import { GRADING_JOB_TYPE } from './services/special-master'
import { TOOL_STEP_JOB_TYPE } from './services/tool-loop'
import { SqlBatchDatabase } from './db/sql-batch-database'
import { storeStub, type ModelCourtStore } from './db/store-object'
import { allowlistedFetch } from './providers/endpoints'
import type { BackupFiles } from './services/store-backup'

/**
 * V9 (D-117): the app owner's private files folder (`scope: 'self'`), used only for sealed backups.
 * The owner downloads from it with `npx deepspace app files get --private <key>`; it is never public.
 */
function ownerBackupFiles(env: Env): BackupFiles | undefined {
  if (!env.OWNER_USER_ID) return undefined
  const files = () => appFiles(env as unknown as AppFilesEnv, { scope: 'self', userId: env.OWNER_USER_ID })
  return {
    upload: async (key, body) => {
      await files().upload(new Blob([body], { type: 'application/json' }), { key, name: key.split('/').pop() })
    },
    list: async (prefix) => {
      const out: Array<{ key: string; ref: string }> = []
      let cursor: string | undefined
      // Bounded: retention keeps at most 60 backups, so a few pages at most.
      for (let page = 0; page < 20; page++) {
        const result = await files().list({ prefix, limit: 100, ...(cursor ? { cursor } : {}) })
        out.push(...result.files.map((file) => ({ key: file.relativeKey, ref: file.key })))
        if (!result.cursor) break
        cursor = result.cursor
      }
      return out
    },
    remove: async (ref) => {
      await files().delete(ref)
    },
  }
}

/**
 * A fresh adapter (and Durable Object stub) per call of platformDeps, i.e. per
 * request, job, or cron run. Stubs are I/O objects tied to the context that
 * created them; sharing one across contexts fails with "Cannot perform I/O on
 * behalf of a different Durable Object" (production incident, D-22).
 */
function storeDatabase(env: Env): D1Database {
  const stub = storeStub(env.MODEL_COURT_STORE as unknown as DurableObjectNamespace<ModelCourtStore>)
  return new SqlBatchDatabase((statements) => stub.execute(statements)).asD1()
}

/** Trusted server write into the app RecordRoom; bypasses collection RBAC by design. */
async function recordTool(env: Env, tool: string, params: Record<string, unknown>): Promise<void> {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response = await stub.fetch(
    new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': env.OWNER_USER_ID, 'X-App-Action': 'true' },
      body: JSON.stringify({ tool, params }),
    }),
  )
  const result = (await response.json()) as { success?: boolean }
  if (!response.ok || result.success === false) throw new Error(`record tool ${tool} failed`)
}

export function platformDeps(env: Env): Deps {
  return {
    db: storeDatabase(env),
    // ModelCourtStore migrates itself on start-up.
    ensureSchema: async () => {},
    config: parseConfig(env),
    routes: MODEL_ROUTES,
    priceTables: PRICE_TABLES,
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    verifyToken: async (token) => {
      const { result } = await verifyJwt({ publicKey: env.AUTH_JWT_PUBLIC_KEY, issuer: env.AUTH_JWT_ISSUER }, token)
      return result ? { userId: result.userId, name: typeof result.claims.name === 'string' ? result.claims.name : null } : null
    },
    // IDs only; maxAttempts 1 — an explicit user retry creates a new application attempt.
    enqueueGeneration: (job) => enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, GENERATION_JOB_TYPE, job, { maxAttempts: 1 }),
    enqueueGrading: (job) => enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, GRADING_JOB_TYPE, job, { maxAttempts: 1 }),
    // Spec 06 §7.3: one job per tool step, IDs only, never retried by the queue.
    enqueueToolStep: (job) => enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, TOOL_STEP_JOB_TYPE, job, { maxAttempts: 1 }),
    publishNotices: async (notices) => {
      const now = Date.now()
      await Promise.all(
        notices.map((notice) =>
          recordTool(env, 'records.create', {
            collection: NOTICES_COLLECTION,
            // One coalesced row per recipient and run.
            recordId: `${notice.recipientUserId}:${notice.runId ?? notice.evaluationId}`,
            data: { recipientUserId: notice.recipientUserId, evaluationId: notice.evaluationId, runId: notice.runId, revision: now, updatedAt: now },
          }),
        ),
      )
    },
    purgeNotices: async (evaluationId) => {
      await recordTool(env, 'records.deleteWhere', { collection: NOTICES_COLLECTION, where: { evaluationId }, limit: 500 })
    },
    // Spec 07 §6.5: the explicit outbound allowlist; adapters and the key check narrow it to one provider.
    providerFetch: allowlistedFetch((input, init) => fetch(input, init), undefined, (event) => console.log(JSON.stringify({ app: 'model-court', ...event }))),
    log: (event) => console.log(JSON.stringify({ app: 'model-court', ...event })),
    backupFiles: ownerBackupFiles(env),
  }
}
