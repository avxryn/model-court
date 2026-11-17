/**
 * Model Court /api/v1 boundary (spec §6.2): identity, input validation,
 * HTTP mapping. Business rules live in services; SQL in services/db helpers.
 */

import { Hono, type Context } from 'hono'
import {
  cancelRunSchema,
  createCredentialSchema,
  createEvaluationSchema,
  deleteEvaluationSchema,
  draftInputSchema,
  emptySchema,
  openReviewSchema,
  redeemInviteSchema,
  retrySchema,
  revealSchema,
  saveRatingsSchema,
  startRunSchema,
  verdictSchema,
} from '../domain/contracts'
import { LIMITS } from '../domain/limits'
import { isRouteEnabled, PROVIDER_NAMES, PROVIDER_REGISTRY_VERSION } from '../domain/registry'
import { hitRateLimit } from './db/sql'
import type { Deps, VerifiedCaller } from './deps'
import { ApiError, errorResponse, idempotencyKey, ifMatchRevision, noContent, ok, pathId, readBody, requestIdOf } from './http'
import { listCredentials, removeCredential, renewCredential, saveCredential } from './services/credentials'
import { createEvaluation, deleteEvaluation, getEvaluation, listEvaluations, saveDraft } from './services/evaluations'
import { exportRun, parseExportFormat } from './services/export'
import { getResults, recordVerdict } from './services/results'
import { createInvite, getReview, redeemInvite, reveal, revokeInvite, revokeSession, saveReview, submitReview } from './services/reviews'
import { cancelRun, getRun, openReview, retryGenerations, startRun } from './services/runs'

const UTF8_BOM = String.fromCharCode(0xfeff)

type Vars = { deps: Deps; caller: VerifiedCaller; requestId: string }
type ApiContext = Context<{ Variables: Vars }>

function optionalIfMatch(c: ApiContext): number | null {
  return c.req.header('If-Match') ? ifMatchRevision(c) : null
}

export function createApi(resolveDeps: (c: Context) => Deps | Promise<Deps>): Hono<{ Variables: Vars }> {
  const api = new Hono<{ Variables: Vars }>()

  api.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error)
    const deps = c.get('deps')
    // Never log the error object: provider and request data may be attached to it.
    deps?.log({ event: 'api.error', requestId: requestIdOf(c), path: new URL(c.req.url).pathname, name: error instanceof Error ? error.name : 'unknown' })
    return errorResponse(c, new ApiError(500, 'INTERNAL', 'Something went wrong. Reference the request ID if you report it.'))
  })

  api.use('*', async (c, next) => {
    requestIdOf(c)
    const deps = await resolveDeps(c)
    c.set('deps', deps)
    await deps.ensureSchema()
    await next()
    c.header('X-Request-Id', requestIdOf(c))
  })

  // Identity: only a verified platform JWT; caller-supplied user IDs are never read.
  api.use('*', async (c, next) => {
    const header = c.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    const caller = token ? await c.get('deps').verifyToken(token) : null
    if (!caller) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    c.set('caller', caller)
    await next()
  })

  // Mutations: same-origin check plus per-user rate limits (spec §6.5, §9.1).
  api.use('*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
    const origin = c.req.header('Origin')
    const deps = c.get('deps')
    const expected = deps.config.publicOrigin ?? new URL(c.req.url).origin
    if (origin && origin !== expected && origin !== new URL(c.req.url).origin) {
      throw new ApiError(403, 'FORBIDDEN', 'Cross-origin requests are not allowed.')
    }
    const userId = c.get('caller').userId
    const now = deps.now()
    const general = await hitRateLimit(deps.db, `mut:${userId}`, 30, now)
    if (!general.allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many changes in a minute. Try again shortly.', { retryAfterSeconds: general.retryAfterSeconds })
    if (/\/(runs|retries)$/.test(new URL(c.req.url).pathname)) {
      const generation = await hitRateLimit(deps.db, `gen:${userId}`, 5, now)
      if (!generation.allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many generation requests. Try again shortly.', { retryAfterSeconds: generation.retryAfterSeconds })
    }
    await next()
  })

  const deps = (c: ApiContext) => c.get('deps')
  const user = (c: ApiContext) => c.get('caller').userId
  const rid = (c: ApiContext) => requestIdOf(c)

  // Catalog: verified selectable routes; never reveals which ones a run selected.
  api.get('/catalog', (c) =>
    ok(c, {
      providerRegistryVersion: PROVIDER_REGISTRY_VERSION,
      generationEnabled: deps(c).config.generationEnabled,
      credentialWritesEnabled: deps(c).config.credentialWritesEnabled,
      providers: Object.entries(PROVIDER_NAMES).map(([id, name]) => ({ id, name })),
      models: deps(c).routes.map((route) => ({ key: route.key, provider: route.provider, modelId: route.modelId, label: route.label, enabled: isRouteEnabled(route), verifiedAt: route.verifiedAt })),
      limits: { maxCases: LIMITS.maxCases, configurations: deps(c).config.maxConfigurationsPerRun, minConfigurations: LIMITS.minConfigurationsPerRun, maxOutputTokens: LIMITS.maxOutputTokens, maxAttemptsPerGeneration: LIMITS.maxAttemptsPerGeneration, credentialTtlDays: Math.round(deps(c).config.credentialTtlMs / 86_400_000), ...deps(c).config.limits },
    }),
  )

  // Credentials -------------------------------------------------------------
  api.get('/credentials', async (c) => ok(c, { items: await listCredentials(deps(c), user(c)) }))
  api.post('/credentials', async (c) => {
    const input = await readBody(c, createCredentialSchema, LIMITS.credentialRequestBytes)
    const result = await saveCredential(deps(c), user(c), input, idempotencyKey(c), optionalIfMatch(c), rid(c))
    return ok(c, result.data, result.status)
  })
  api.post('/credentials/:id/renew', async (c) => {
    const ifMatch = ifMatchRevision(c)
    await readBody(c, emptySchema)
    return ok(c, await renewCredential(deps(c), user(c), pathId(c, 'id'), ifMatch, rid(c)))
  })
  api.delete('/credentials/:id', async (c) => {
    await removeCredential(deps(c), user(c), pathId(c, 'id'), optionalIfMatch(c), rid(c))
    return noContent(c)
  })

  // Evaluations -------------------------------------------------------------
  api.get('/evaluations', async (c) => ok(c, await listEvaluations(deps(c), user(c), c.req.query('cursor'), Number(c.req.query('limit') ?? 20))))
  api.post('/evaluations', async (c) => ok(c, await createEvaluation(deps(c), user(c), await readBody(c, createEvaluationSchema), rid(c)), 201))
  api.get('/evaluations/:id', async (c) => {
    const evaluation = await getEvaluation(deps(c), user(c), pathId(c, 'id'))
    return ok(c, evaluation, 200, 'revision' in evaluation ? { ETag: `"${evaluation.revision}"` } : {})
  })
  api.put('/evaluations/:id/draft', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, draftInputSchema)
    return ok(c, await saveDraft(deps(c), user(c), pathId(c, 'id'), input, ifMatch))
  })
  api.delete('/evaluations/:id', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, deleteEvaluationSchema)
    return ok(c, await deleteEvaluation(deps(c), user(c), pathId(c, 'id'), input.confirmTitle, ifMatch, rid(c)), 202)
  })
  api.post('/evaluations/:id/runs', async (c) => {
    const input = await readBody(c, startRunSchema)
    const result = await startRun(deps(c), user(c), pathId(c, 'id'), input, idempotencyKey(c), rid(c))
    return ok(c, result.data, result.status)
  })

  // Runs --------------------------------------------------------------------
  api.get('/runs/:runId', async (c) => {
    const run = await getRun(deps(c), user(c), pathId(c, 'runId'))
    return ok(c, run, 200, { ETag: `"${run.revision}"` })
  })
  api.post('/runs/:runId/retries', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, retrySchema)
    const result = await retryGenerations(deps(c), user(c), pathId(c, 'runId'), input, ifMatch, idempotencyKey(c), rid(c))
    return ok(c, result.data, result.status)
  })
  api.post('/runs/:runId/cancel', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, cancelRunSchema)
    return ok(c, await cancelRun(deps(c), user(c), pathId(c, 'runId'), input, ifMatch, rid(c)))
  })
  api.post('/runs/:runId/open-review', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, openReviewSchema)
    return ok(c, await openReview(deps(c), user(c), pathId(c, 'runId'), input.acknowledgeExcludedCases, ifMatch, rid(c)))
  })
  api.post('/runs/:runId/invites', async (c) => {
    await readBody(c, emptySchema)
    const result = await createInvite(deps(c), user(c), pathId(c, 'runId'), new URL(c.req.url).origin, idempotencyKey(c), rid(c))
    return ok(c, result.data, result.status)
  })
  api.delete('/runs/:runId/invites/:inviteId', async (c) => {
    await revokeInvite(deps(c), user(c), pathId(c, 'runId'), pathId(c, 'inviteId'), rid(c))
    return noContent(c)
  })
  api.post('/invites/redeem', async (c) => {
    const input = await readBody(c, redeemInviteSchema)
    return ok(c, await redeemInvite(deps(c), user(c), input.token, rid(c)))
  })
  api.get('/runs/:runId/review', async (c) => {
    const review = await getReview(deps(c), user(c), pathId(c, 'runId'))
    return ok(c, review, 200, { ETag: `"${review.sessionRevision}"` })
  })
  api.put('/runs/:runId/review', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, saveRatingsSchema)
    return ok(c, await saveReview(deps(c), user(c), pathId(c, 'runId'), input, ifMatch))
  })
  api.post('/runs/:runId/review/submit', async (c) => {
    const ifMatch = ifMatchRevision(c)
    await readBody(c, emptySchema)
    const result = await submitReview(deps(c), user(c), pathId(c, 'runId'), ifMatch, idempotencyKey(c), rid(c))
    return ok(c, result.data, result.status)
  })
  api.delete('/runs/:runId/reviewers/:sessionId', async (c) => {
    await revokeSession(deps(c), user(c), pathId(c, 'runId'), pathId(c, 'sessionId'), rid(c))
    return noContent(c)
  })
  api.post('/runs/:runId/reveal', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, revealSchema)
    const result = await reveal(deps(c), user(c), pathId(c, 'runId'), input.acknowledgePendingCount, ifMatch, idempotencyKey(c), rid(c))
    return ok(c, result.data, result.status)
  })
  api.get('/runs/:runId/results', async (c) => ok(c, await getResults(deps(c), user(c), pathId(c, 'runId'))))
  // Certified record: owner-only, after reveal. JSON in the usual envelope, or CSV as a file.
  api.get('/runs/:runId/export', async (c) => {
    const format = parseExportFormat(c.req.query('format'))
    const result = await exportRun(deps(c), user(c), pathId(c, 'runId'), format, rid(c))
    const disposition = { 'Content-Disposition': `attachment; filename="${result.filename}"` }
    if (result.format === 'json') return ok(c, result.record, 200, disposition)
    // UTF-8 BOM so spreadsheet apps detect the encoding; cells are formula-neutralized.
    return c.body(UTF8_BOM + result.csv, 200, {
      ...disposition,
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': rid(c),
    })
  })
  api.post('/runs/:runId/verdicts', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, verdictSchema)
    const result = await recordVerdict(deps(c), user(c), pathId(c, 'runId'), input, ifMatch, idempotencyKey(c), rid(c))
    return ok(c, result.data, result.status)
  })

  api.all('*', () => {
    throw new ApiError(404, 'NOT_FOUND', 'Not found.')
  })

  return api
}
