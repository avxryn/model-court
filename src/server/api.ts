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
  putImportsSchema, putSourcesSchema, putTextDocumentSchema,
  draftInputSchema,
  duplicateEvaluationSchema,
  emptySchema,
  openReviewSchema,
  redeemInviteSchema,
  retrySchema,
  revealSchema,
  saveRatingsSchema,
  restoreDraftSchema,
  startRunSchema,
  startSpecialMasterSchema,
  verdictSchema,
} from '../domain/contracts'
import { LIMITS } from '../domain/limits'
import { isRouteEnabled, priceTableFor, PROVIDER_NAMES, PROVIDER_REGISTRY_VERSION } from '../domain/registry'
import { extractionLimits } from '../domain/extraction/limits'
import { hitRateLimit } from './db/sql'
import type { Deps, VerifiedCaller } from './deps'
import { ApiError, errorResponse, idempotencyKey, ifMatchRevision, noContent, ok, pathId, readBody, requestIdOf } from './http'
import { checkCredential, listCredentials, removeCredential, renewCredential, saveCredential } from './services/credentials'
import { createEvaluation, deleteEvaluation, deleteImports, getEvaluation, listEvaluations, putImports, saveDraft } from './services/evaluations'
import { exportRun, parseExportFormat } from './services/export'
import { getResults, recordVerdict } from './services/results'
import { createInvite, fileAndUnseal, getReview, redeemInvite, reveal, revokeInvite, revokeSession, saveReview, submitReview } from './services/reviews'
import { getQuota } from './services/quota'
import { cancelRun, getRun, openReview, retryGenerations, startRun } from './services/runs'
import { getComparison, parseRunIds } from './services/comparison'
import { duplicateEvaluation, exportScenario, restoreDraft } from './services/scenarios'
import { deleteDocument, getDraftDocument, getRunDocument, putPdfDocument, putTextDocument } from './services/documents'
import { deleteSources, putSources } from './services/sources'
import { cancelSpecialMaster, getSpecialMaster, startSpecialMaster } from './services/special-master'
import {
  GUEST_COOKIE_PREFIX,
  guestCookieHeader,
  guestRedeemSchema,
  guestResumeSchema,
  guestRoute,
  isGuestId,
  readCookie,
  redeemInviteAsGuest,
  resumeGuest,
  signOutGuestDevices,
  verifyGuestCookie,
  type GuestGrant,
} from './services/guest-jurors'

const UTF8_BOM = String.fromCharCode(0xfeff)

type Vars = { deps: Deps; caller: VerifiedCaller; requestId: string; guest: boolean }
type ApiContext = Context<{ Variables: Vars }>

function optionalIfMatch(c: ApiContext): number | null {
  return c.req.header('If-Match') ? ifMatchRevision(c) : null
}

/** Spec 04 §5: a raw upload body (a PDF), refused before reading when its declared size is over the cap. */
async function readRawBody(c: { req: { header: (name: string) => string | undefined; raw: Request } }, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = () => new ApiError(413, 'PAYLOAD_TOO_LARGE', `A PDF is at most ${maxBytes / 1024 / 1024} MiB.`)
  // D-91: a declared length is required and checked first; the stream is counted and cut at the cap,
  // so a body without one (or lying about it) is never buffered past 4 MiB.
  const declared = c.req.header('Content-Length')
  if (declared === undefined || !/^\d{1,10}$/u.test(declared)) throw new ApiError(411, 'BAD_REQUEST', 'A PDF upload needs a Content-Length header.')
  if (Number(declared) > maxBytes) throw tooLarge()
  const body = c.req.raw.body
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const out = new Uint8Array(Math.min(Number(declared), maxBytes))
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (total + value.byteLength > out.length) {
      await reader.cancel()
      throw total + value.byteLength > maxBytes ? tooLarge() : new ApiError(400, 'BAD_REQUEST', 'The upload is longer than its Content-Length.')
    }
    out.set(value, total)
    total += value.byteLength
  }
  return out.subarray(0, total).slice()
}

/** Spec 04 §5: every document byte response downloads under a fixed name and never renders in the app's origin. */
function documentBytes(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="document.pdf"',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
      // D-91: not embeddable by any other site.
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  })
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

  /**
   * Cookie-setting guest endpoints (D-41) need a strict same-origin request: Origin present and ours,
   * or the browser's Sec-Fetch-Site saying so. A cross-site form or script cannot pass this.
   */
  const requireSameOrigin = (c: ApiContext) => {
    const origin = c.req.header('Origin')
    const expected = c.get('deps').config.publicOrigin ?? new URL(c.req.url).origin
    const sameOrigin = (origin && (origin === expected || origin === new URL(c.req.url).origin)) || (!origin && c.req.header('Sec-Fetch-Site') === 'same-origin')
    if (!sameOrigin) throw new ApiError(403, 'FORBIDDEN', 'Cross-origin requests are not allowed.')
  }
  const clientIp = (c: ApiContext) => c.req.header('CF-Connecting-IP') ?? null
  const guestReply = (c: ApiContext, grant: GuestGrant) => {
    c.header('Set-Cookie', guestCookieHeader(grant.runId, grant.cookieValue))
    // The resume secret is returned once, in the body only; the cookie value never is.
    return ok(c, { runId: grant.runId, ...(grant.resumeSecret ? { resumeSecret: grant.resumeSecret } : {}) }, 201)
  }

  // Accountless jurors (D-41): the only routes reachable without any credential.
  api.post('/invites/redeem-as-guest', async (c) => {
    requireSameOrigin(c)
    const input = await readBody(c, guestRedeemSchema)
    // If a signed-in user sends this, they cannot use it to take a second seat (or the judge a juror seat).
    const header = c.req.header('Authorization')
    const signedIn = header?.startsWith('Bearer ') ? await c.get('deps').verifyToken(header.slice(7)) : null
    return guestReply(c, await redeemInviteAsGuest(c.get('deps'), input, clientIp(c), requestIdOf(c), signedIn?.userId ?? null))
  })
  api.post('/juror/resume', async (c) => {
    requireSameOrigin(c)
    const input = await readBody(c, guestResumeSchema)
    return guestReply(c, await resumeGuest(c.get('deps'), input, clientIp(c), requestIdOf(c), c.req.header('Cookie')))
  })

  // Identity: a verified platform JWT, or (D-41) a guest-juror cookie on the few review routes of its own hearing.
  api.use('*', async (c, next) => {
    const header = c.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    if (token) {
      const caller = await c.get('deps').verifyToken(token)
      // The guest namespace can never be claimed by a token.
      if (!caller || isGuestId(caller.userId)) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
      c.set('caller', caller)
      c.set('guest', false)
      return next()
    }
    const runId = guestRoute(c.req.method, new URL(c.req.url).pathname)
    const caller = runId ? await verifyGuestCookie(c.get('deps'), runId, readCookie(c.req.header('Cookie'), `${GUEST_COOKIE_PREFIX}${runId}`)) : null
    if (!caller) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    c.set('caller', caller)
    c.set('guest', true)
    await next()
  })

  // Reads (D-13): per-caller limit, guests included.
  api.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
    const deps = c.get('deps')
    const reads = await hitRateLimit(deps.db, `read:${c.get('caller').userId}`, LIMITS.readsPerMinute, deps.now())
    if (!reads.allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests in a minute. Try again shortly.', { retryAfterSeconds: reads.retryAfterSeconds })
    await next()
  })

  // Mutations: same-origin check plus per-user rate limits (spec §6.5, §9.1).
  api.use('*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
    // Cookie-authenticated guests must prove same origin; Bearer requests keep the earlier rule.
    if (c.get('guest')) requireSameOrigin(c)
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
    if (/\/(runs|retries|special-master)$/.test(new URL(c.req.url).pathname)) {
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
      // Spec 07 (D-108): the table in effect today; later-dated tables (announced price changes) wait for their day.
      priceTable: (({ version, readOn, sources }) => ({ version, readOn, sources }))(priceTableFor(deps(c).now(), deps(c).priceTables).table),
      generationEnabled: deps(c).config.generationEnabled,
      credentialWritesEnabled: deps(c).config.credentialWritesEnabled,
      providers: Object.entries(PROVIDER_NAMES).map(([id, name]) => ({ id, name })),
      models: deps(c).routes.map((route) => ({
        key: route.key,
        provider: route.provider,
        modelId: route.modelId,
        label: route.label,
        line: route.line,
        contextTokens: route.contextTokens,
        providerMaxOutputTokens: route.providerMaxOutputTokens,
        reasoning: route.reasoning,
        retiresNotBefore: route.retiresNotBefore,
        docsUrl: route.docsUrl,
        enabled: isRouteEnabled(route),
        verifiedAt: route.verifiedAt,
        multiTurnVerifiedAt: route.multiTurnVerifiedAt,
        structuredVerifiedAt: route.structuredVerifiedAt,
        pdfVerifiedAt: route.pdfVerifiedAt,
        toolsVerifiedAt: route.toolsVerifiedAt,
        adapterVersion: route.adapterVersion,
      })),
      limits: { maxCases: LIMITS.maxCases, configurations: deps(c).config.maxConfigurationsPerRun, maxTestimoniesPerHearing: LIMITS.maxTestimoniesPerHearing, samplesPerAnswer: deps(c).config.maxSamplesPerAnswer, minConfigurations: LIMITS.minConfigurationsPerRun, maxOutputTokens: LIMITS.maxOutputTokens, reasoningHeadroomTokens: LIMITS.reasoningHeadroomTokens, maxAttemptsPerGeneration: LIMITS.maxAttemptsPerGeneration, credentialTtlDays: Math.round(deps(c).config.credentialTtlMs / 86_400_000), ...deps(c).config.limits, extraction: extractionLimits() },
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
  // D-57: a free list-models request with the stored key; the response carries only the result.
  api.post('/credentials/:id/check', async (c) => {
    await readBody(c, emptySchema)
    return ok(c, await checkCredential(deps(c), user(c), pathId(c, 'id'), rid(c)))
  })
  api.delete('/credentials/:id', async (c) => {
    await removeCredential(deps(c), user(c), pathId(c, 'id'), optionalIfMatch(c), rid(c))
    return noContent(c)
  })

  // Provider-call caps (D-57): read-only counts for the caller and the deployment.
  api.get('/quota', async (c) => ok(c, await getQuota(deps(c), user(c))))

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
  api.put('/evaluations/:id/imports/:configurationKey', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, putImportsSchema)
    return ok(c, await putImports(deps(c), user(c), pathId(c, 'id'), pathId(c, 'configurationKey'), input, ifMatch, rid(c)))
  })
  // Spec 04 (D-87): the document of one extraction question. Text as JSON here; PDF bytes in step B.
  api.put('/evaluations/:id/documents/:caseKey', async (c) => {
    const ifMatch = ifMatchRevision(c)
    // Spec 04 §5 (D-89): a PDF arrives as raw bytes under its own 4 MiB cap; anything else is the text JSON.
    if ((c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase() === 'application/pdf') {
      const bytes = await readRawBody(c, LIMITS.extraction.pdfBytes)
      const pages = c.req.header('X-Page-Count') ?? ''
      return ok(c, await putPdfDocument(deps(c), user(c), pathId(c, 'id'), pathId(c, 'caseKey'), bytes, /^\d{1,3}$/u.test(pages) ? Number(pages) : Number.NaN, ifMatch, rid(c)))
    }
    const input = await readBody(c, putTextDocumentSchema)
    return ok(c, await putTextDocument(deps(c), user(c), pathId(c, 'id'), pathId(c, 'caseKey'), input.text, ifMatch, rid(c)))
  })
  api.delete('/evaluations/:id/documents/:caseKey', async (c) => {
    const ifMatch = ifMatchRevision(c)
    return ok(c, await deleteDocument(deps(c), user(c), pathId(c, 'id'), pathId(c, 'caseKey'), ifMatch, rid(c)))
  })
  api.get('/evaluations/:id/documents/:caseKey', async (c) => {
    const document = await getDraftDocument(deps(c), user(c), pathId(c, 'id'), pathId(c, 'caseKey'))
    if (document.kind === 'text') return ok(c, document, 200, { 'Cache-Control': 'private, no-store' })
    return documentBytes(document.bytes)
  })
  // Spec 05 §5.1 (D-93): the numbered sources of one grounded question, replaced as a whole.
  api.put('/evaluations/:id/sources/:caseKey', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, putSourcesSchema)
    return ok(c, await putSources(deps(c), user(c), pathId(c, 'id'), pathId(c, 'caseKey'), input, ifMatch, rid(c)))
  })
  api.delete('/evaluations/:id/sources/:caseKey', async (c) => {
    const ifMatch = ifMatchRevision(c)
    return ok(c, await deleteSources(deps(c), user(c), pathId(c, 'id'), pathId(c, 'caseKey'), ifMatch, rid(c)))
  })
  api.delete('/evaluations/:id/imports/:configurationKey', async (c) => {
    const ifMatch = ifMatchRevision(c)
    return ok(c, await deleteImports(deps(c), user(c), pathId(c, 'id'), pathId(c, 'configurationKey'), ifMatch, rid(c)))
  })
  // Spec 02 (D-69): restore a hearing's questions and/or parties into the draft. No provider call.
  api.post('/evaluations/:id/draft/restore', async (c) => {
    const ifMatch = ifMatchRevision(c)
    const input = await readBody(c, restoreDraftSchema)
    return ok(c, await restoreDraft(deps(c), user(c), pathId(c, 'id'), input, ifMatch, rid(c)))
  })
  // Spec 02 (D-70): unsealed hearings of one case side by side, owner only.
  api.get('/evaluations/:id/comparison', async (c) => ok(c, await getComparison(deps(c), user(c), pathId(c, 'id'), parseRunIds(c.req.query('runIds')))))
  // Spec 02 (D-71): copy a case (its draft or one hearing's setup) into a new case; no runs, sessions or keys.
  api.post('/evaluations/:id/duplicate', async (c) => {
    const input = await readBody(c, duplicateEvaluationSchema)
    const result = await duplicateEvaluation(deps(c), user(c), pathId(c, 'id'), input, idempotencyKey(c), rid(c))
    return ok(c, result.data, result.status)
  })
  // Spec 02 (D-71): the case's questions (and, if asked, parties) as a scenario file.
  api.get('/evaluations/:id/scenario', async (c) => {
    const fromRunId = c.req.query('fromRunId') || undefined
    const includeParties = c.req.query('includeParties') ?? 'false'
    if ((fromRunId !== undefined && !/^[0-9a-f-]{36}$/i.test(fromRunId)) || (includeParties !== 'true' && includeParties !== 'false')) throw new ApiError(400, 'BAD_REQUEST', 'Use fromRunId=<hearing id> and includeParties=true or false.')
    const result = await exportScenario(deps(c), user(c), pathId(c, 'id'), fromRunId, includeParties === 'true', rid(c))
    return ok(c, result.file, 200, { 'Content-Disposition': `attachment; filename="${result.filename}"` })
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
  // A judge with no jury: file the judge's worksheet and unseal in one commit. If-Match is the session revision.
  api.post('/runs/:runId/review/file-and-unseal', async (c) => {
    const ifMatch = ifMatchRevision(c)
    await readBody(c, emptySchema)
    const result = await fileAndUnseal(deps(c), user(c), pathId(c, 'runId'), ifMatch, idempotencyKey(c), rid(c))
    return ok(c, result.data, result.status)
  })
  api.post('/runs/:runId/reviewers/:sessionId/sign-out-devices', async (c) => {
    await readBody(c, emptySchema)
    await signOutGuestDevices(deps(c), user(c), pathId(c, 'runId'), pathId(c, 'sessionId'), rid(c))
    return noContent(c)
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
  // Spec 04 §5 (D-89): the hearing's copy of a question's document, for the judge and the hearing's jurors (guests included).
  api.get('/runs/:runId/documents/:caseKey', async (c) => {
    const document = await getRunDocument(deps(c), user(c), pathId(c, 'runId'), pathId(c, 'caseKey'))
    if (document.kind === 'text') return ok(c, document)
    return documentBytes(document.bytes)
  })
  api.get('/runs/:runId/results', async (c) => ok(c, await getResults(deps(c), user(c), pathId(c, 'runId'))))
  // Certified record: owner-only, after reveal. JSON in the usual envelope, or CSV as a file.
  // Special master (D-40): owner only, after unsealing.
  api.get('/runs/:runId/special-master', async (c) => ok(c, await getSpecialMaster(deps(c), user(c), pathId(c, 'runId'))))
  api.post('/runs/:runId/special-master', async (c) => {
    const input = await readBody(c, startSpecialMasterSchema)
    const result = await startSpecialMaster(deps(c), user(c), pathId(c, 'runId'), input, idempotencyKey(c), rid(c))
    return ok(c, result.data, result.status)
  })
  api.post('/runs/:runId/special-master/:graderRunId/cancel', async (c) => {
    await readBody(c, emptySchema)
    return ok(c, await cancelSpecialMaster(deps(c), user(c), pathId(c, 'runId'), pathId(c, 'graderRunId'), rid(c)))
  })
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
