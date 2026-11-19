/**
 * Documents of extraction questions (spec 04 §4.2, §4.5, D-87).
 *
 * Bytes are stored once per owner (`document_blobs`, content-addressed by sha256) as base64
 * chunks, referenced by draft questions (`evaluation_documents`, replaceable) and by hearings
 * (`run_documents`, immutable). Every upload counts against two byte buckets in one guarded
 * batch, so an over-quota upload changes nothing. A question's `kitFields.document` in the stored
 * draft mirrors its `evaluation_documents` row: every draft write sets it from the table, so the
 * question and snapshot hashes commit to the exact bytes. Document text, bytes and file names
 * never reach a log, an audit row, a notice or a job payload.
 */

import { toHex } from '../../domain/canonical'
import type { Draft } from '../../domain/contracts'
import { base64ToBytes, bytesToBase64, chunkBase64, sniffPdf } from '../../domain/extraction/bytes'
import type { DocumentRef, ExtractionFields } from '../../domain/kits/extraction'
import { LIMITS } from '../../domain/limits'
import type { TemplateDocument } from '../../domain/messages'
import { auditStatement, classifyConstraint, cond, GuardFailed, hitRateLimit, hitRateLimitWindow, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, notFound, revisionConflict } from '../http'
import { loadEvaluationAccess, loadRunAccess, requireOwner } from '../access'
import { parseStoredDraft } from './evaluations'

export const UPLOADS_PER_HOUR = 20
export const DOCUMENT_READS_PER_MINUTE = 30
const SWEEP_BATCH = 20
const SWEEP_MIN_AGE_MS = 10 * 60_000

export type DocumentKind = 'text' | 'pdf'
export type Delivery = 'text' | 'pdf_native'

export interface DocumentMeta {
  caseKey: string
  kind: DocumentKind
  delivery: Delivery
  sha256: string
  byteLength: number
  pageCount: number | null
  /** False after a restore that left out this PDF's bytes (spec 04 §4.6). */
  available: boolean
}

interface RefRow {
  case_key: string
  blob_id: string
  delivery: Delivery
  sha256: string
  media_type: string
  byte_length: number
  page_count: number | null
  chunk_count: number
  chunks_present: number
}

function metaOf(row: RefRow): DocumentMeta {
  return {
    caseKey: row.case_key,
    kind: row.media_type === 'application/pdf' ? 'pdf' : 'text',
    delivery: row.delivery,
    sha256: row.sha256,
    byteLength: row.byte_length,
    pageCount: row.page_count,
    available: row.chunks_present === row.chunk_count,
  }
}

const REF_COLUMNS = `b.sha256, b.media_type, b.byte_length, b.page_count, b.chunk_count,
  (SELECT COUNT(*) FROM document_blob_chunks c WHERE c.blob_id = b.id) AS chunks_present`

/** The draft's documents, one per question that has one. */
export async function listDraftDocuments(db: D1Database, evaluationId: string): Promise<DocumentMeta[]> {
  const rows = await db
    .prepare(`SELECT d.case_key, d.blob_id, d.delivery, ${REF_COLUMNS} FROM evaluation_documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.evaluation_id = ? ORDER BY d.case_key`)
    .bind(evaluationId)
    .all<RefRow>()
  return rows.results.map(metaOf)
}

/** A hearing's frozen documents. */
export async function listRunDocuments(db: D1Database, runId: string): Promise<DocumentMeta[]> {
  const rows = await db
    .prepare(`SELECT d.case_key, d.blob_id, d.delivery, ${REF_COLUMNS} FROM run_documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.run_id = ? ORDER BY d.case_key`)
    .bind(runId)
    .all<RefRow>()
  return rows.results.map(metaOf)
}

export function refOf(meta: Pick<DocumentMeta, 'sha256' | 'byteLength' | 'delivery' | 'pageCount'>): DocumentRef {
  return { sha256: meta.sha256, byteLength: meta.byteLength, delivery: meta.delivery, pageCount: meta.pageCount }
}

/**
 * The draft with each extraction question's `kitFields.document` set from the table (or removed).
 * Other kits' questions are untouched. Pure.
 */
export function withDocumentRefs(draft: Draft, documents: readonly Pick<DocumentMeta, 'caseKey' | 'sha256' | 'byteLength' | 'delivery' | 'pageCount'>[]): Draft {
  if (draft.kit?.version !== 'extraction-v1') return draft
  const byCase = new Map(documents.map((document) => [document.caseKey, document]))
  return {
    ...draft,
    cases: draft.cases.map((testCase) => {
      const fields = testCase.kitFields as ExtractionFields | undefined
      const found = byCase.get(testCase.key)
      const { document: _old, ...rest } = fields?.kind === 'extraction' ? fields : ({ kind: 'extraction' } as ExtractionFields)
      const next: ExtractionFields = found ? { ...rest, document: refOf(found) } : rest
      return { ...testCase, kitFields: next }
    }),
  }
}

async function chunksOf(db: D1Database, blobId: string): Promise<string | null> {
  const blob = await db.prepare('SELECT chunk_count FROM document_blobs WHERE id = ?').bind(blobId).first<{ chunk_count: number }>()
  if (!blob) return null
  const rows = await db.prepare('SELECT chunk_no, data_base64 FROM document_blob_chunks WHERE blob_id = ? ORDER BY chunk_no').bind(blobId).all<{ chunk_no: number; data_base64: string }>()
  if (rows.results.length !== blob.chunk_count || rows.results.some((row, index) => row.chunk_no !== index)) return null
  return rows.results.map((row) => row.data_base64).join('')
}

/** A blob's base64, or null when its chunks are missing (a restored PDF). */
export const readBlobBase64 = chunksOf

export async function readBlobText(db: D1Database, blobId: string): Promise<string | null> {
  const base64 = await chunksOf(db, blobId)
  return base64 === null ? null : new TextDecoder().decode(base64ToBytes(base64))
}

/**
 * What the generation job sends for one question, read from the hearing's own copy. Called only
 * after the claim and the pre-send fence check; the caller drops it when the call returns.
 */
export async function loadRunDocument(db: D1Database, runId: string, caseKey: string, expectedSha256: string | undefined): Promise<TemplateDocument | null> {
  const row = await db.prepare('SELECT d.blob_id, d.sha256, d.delivery FROM run_documents d WHERE d.run_id = ? AND d.case_key = ?').bind(runId, caseKey).first<{ blob_id: string; sha256: string; delivery: Delivery }>()
  if (!row || (expectedSha256 !== undefined && row.sha256 !== expectedSha256)) return null
  const base64 = await chunksOf(db, row.blob_id)
  if (base64 === null) return null
  if (row.delivery === 'pdf_native') return { kind: 'pdf', base64 }
  return { kind: 'text', text: new TextDecoder().decode(base64ToBytes(base64)) }
}

/** Text documents of a hearing, for the reviewer projection; PDFs are fetched on their own route. */
export async function loadRunTextDocuments(db: D1Database, runId: string): Promise<Map<string, { kind: 'text'; text: string } | { kind: 'pdf'; pageCount: number | null; byteLength: number; available: boolean }>> {
  const out = new Map<string, { kind: 'text'; text: string } | { kind: 'pdf'; pageCount: number | null; byteLength: number; available: boolean }>()
  const rows = await db
    .prepare(`SELECT d.case_key, d.blob_id, d.delivery, ${REF_COLUMNS} FROM run_documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.run_id = ?`)
    .bind(runId)
    .all<RefRow>()
  for (const row of rows.results) {
    if (row.media_type === 'text/plain') out.set(row.case_key, { kind: 'text', text: (await readBlobText(db, row.blob_id)) ?? '' })
    else out.set(row.case_key, { kind: 'pdf', pageCount: row.page_count, byteLength: row.byte_length, available: row.chunks_present === row.chunk_count })
  }
  return out
}

// ---------------------------------------------------------------------------
// Upload, remove, read (owner, draft side)
// ---------------------------------------------------------------------------

function storageError(): ApiError {
  return new ApiError(429, 'QUOTA_EXHAUSTED', 'Document storage is full for your account (or for this deployment). Remove documents you no longer need, or delete an old case.', { details: { kind: 'document_storage' } })
}

interface NewBlob {
  mediaType: 'text/plain' | 'application/pdf'
  bytes: Uint8Array<ArrayBuffer>
  pageCount: number | null
  delivery: Delivery
}

/** Stores the bytes (deduped per owner) and points the draft question at them, bumping the revision. */
export async function putDocument(deps: Deps, userId: string, evaluationId: string, caseKey: string, input: NewBlob, ifMatch: number, requestId: string) {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  requireOwner(access)
  const draft = parseStoredDraft(access.evaluation)
  if (draft.kit?.version !== 'extraction-v1' || !draft.cases.some((testCase) => testCase.key === caseKey)) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Save this question in a "pull fields from documents" case first.', { fields: [{ path: 'caseKey', message: 'Not an extraction question in the saved draft' }] })
  }
  if (access.evaluation.revision !== ifMatch) throw revisionConflict()
  const db = deps.db
  const now = deps.now()
  const limit = await hitRateLimitWindow(db, `document:${userId}`, UPLOADS_PER_HOUR, 60 * 60_000, now)
  if (!limit.allowed) throw new ApiError(429, 'RATE_LIMITED', `At most ${UPLOADS_PER_HOUR} document uploads an hour. Try again later.`, { retryAfterSeconds: limit.retryAfterSeconds })

  const sha256 = toHex(await crypto.subtle.digest('SHA-256', input.bytes))
  const existing = await db
    .prepare('SELECT id, media_type, page_count, chunk_count, (SELECT COUNT(*) FROM document_blob_chunks c WHERE c.blob_id = b.id) AS chunks_present FROM document_blobs b WHERE owner_user_id = ? AND sha256 = ?')
    .bind(userId, sha256)
    .first<{ id: string; media_type: string; page_count: number | null; chunk_count: number; chunks_present: number }>()
  if (existing && existing.media_type !== input.mediaType) throw new ApiError(422, 'VALIDATION_FAILED', 'This file was saved before as another kind of document.')
  // Spec 04 §4.6: the same bytes again after a restore that left them out put them back, for drafts and hearings alike.
  const repair = !!existing && existing.chunks_present !== existing.chunk_count
  const blobId = existing?.id ?? deps.newId()
  const chunks = existing && !repair ? [] : chunkBase64(bytesToBase64(input.bytes))
  if (chunks.length > 16 || (repair && chunks.length !== existing!.chunk_count)) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The document is too large.')
  // A stored blob keeps the page count it was stored with.
  const pageCount = existing ? existing.page_count : input.pageCount
  const nextDraft = withDocumentRefs(draft, [
    ...(await listDraftDocuments(db, evaluationId)).filter((document) => document.caseKey !== caseKey),
    { caseKey, sha256, byteLength: input.bytes.length, delivery: input.delivery, pageCount },
  ])
  const draftJson = JSON.stringify(nextDraft)
  if (new TextEncoder().encode(draftJson).byteLength > LIMITS.draftJsonBytes) throw new ApiError(422, 'VALIDATION_FAILED', 'Draft exceeds 96 KiB')
  const quotas = [
    { scope: `user:${userId}`, limit: deps.config.documentStorage.perUserBytes },
    { scope: 'global', limit: deps.config.documentStorage.globalBytes },
  ]
  const statements: D1PreparedStatement[] = [
    ...(existing && !repair
      ? []
      : [
          ...(repair
            ? [db.prepare('DELETE FROM document_blob_chunks WHERE blob_id = ?').bind(blobId)]
            : [
                db
                  .prepare('INSERT INTO document_blobs (id, owner_user_id, sha256, media_type, byte_length, page_count, chunk_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                  .bind(blobId, userId, sha256, input.mediaType, input.bytes.length, input.pageCount, chunks.length, now),
              ]),
          ...chunks.map((chunk, index) => db.prepare('INSERT INTO document_blob_chunks (blob_id, chunk_no, data_base64) VALUES (?, ?, ?)').bind(blobId, index, chunk)),
          ...quotas.map((quota) =>
            db
              .prepare(
                `INSERT INTO document_storage_buckets (scope, used_bytes, limit_bytes) VALUES (?, ?, ?)
                 ON CONFLICT (scope) DO UPDATE SET used_bytes = used_bytes + excluded.used_bytes, limit_bytes = excluded.limit_bytes`,
              )
              .bind(quota.scope, input.bytes.length, quota.limit),
          ),
        ]),
    db
      .prepare(
        `INSERT INTO evaluation_documents (evaluation_id, case_key, blob_id, delivery, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (evaluation_id, case_key) DO UPDATE SET blob_id = excluded.blob_id, delivery = excluded.delivery, updated_at = excluded.updated_at`,
      )
      .bind(evaluationId, caseKey, blobId, input.delivery, now),
    db.prepare('UPDATE evaluations SET draft_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?').bind(draftJson, now, evaluationId),
    // Kind, size, pages and a hash prefix only: never a file name, title or text.
    auditStatement(db, { eventType: 'document.upload', requestId, outcome: 'ok', actorUserId: userId, evaluationId, metadata: { mediaType: input.mediaType, byteLength: input.bytes.length, pageCount, sha256Prefix: sha256.slice(0, 8), ...(repair ? { restored: true } : {}) } }, now),
  ]
  try {
    await runGuarded(
      db,
      'document.upload',
      cond(
        `EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL)${existing ? ` AND EXISTS (SELECT 1 FROM document_blobs b WHERE id = ? AND (SELECT COUNT(*) FROM document_blob_chunks c WHERE c.blob_id = b.id) ${repair ? '<' : '='} b.chunk_count)` : ''}`,
        evaluationId,
        userId,
        ifMatch,
        ...(existing ? [existing.id] : []),
      ),
      statements,
    )
  } catch (error) {
    if (error instanceof GuardFailed) throw revisionConflict()
    const kind = classifyConstraint(error)
    if (kind === 'document_storage') throw storageError()
    // Two identical uploads raced: the other one stored the blob. Ask the client to reload.
    if (kind === 'other' && /document_blobs/u.test(String(error))) throw revisionConflict()
    throw error
  }
  return { revision: ifMatch + 1, draft: nextDraft, document: { kind: input.mediaType === 'application/pdf' ? ('pdf' as const) : ('text' as const), sha256, byteLength: input.bytes.length, pageCount, delivery: input.delivery } }
}

export async function putTextDocument(deps: Deps, userId: string, evaluationId: string, caseKey: string, text: string, ifMatch: number, requestId: string) {
  return putDocument(deps, userId, evaluationId, caseKey, { mediaType: 'text/plain', bytes: new TextEncoder().encode(text), pageCount: null, delivery: 'text' }, ifMatch, requestId)
}

const PDF_REFUSALS = {
  not_pdf: "This file isn't a PDF.",
  truncated: 'This PDF looks cut off (it has no end marker). Save it again and upload it once more.',
  encrypted: "This PDF is password-protected or encrypted. Neither provider can read it: remove the protection and upload it again.",
  empty: 'The file is empty.',
} as const

/**
 * Spec 04 §8.3 (D-89): a PDF delivered as the file itself. Only cheap byte checks, never a parse:
 * the header, the end marker, no encryption key near the end, at most 4 MiB. The page count is
 * the judge's browser's (`X-Page-Count`), 1–20, and drives only the estimate and the cap.
 */
export async function putPdfDocument(deps: Deps, userId: string, evaluationId: string, caseKey: string, bytes: Uint8Array<ArrayBuffer>, pageCount: number, ifMatch: number, requestId: string) {
  const sniff = sniffPdf(bytes, LIMITS.extraction.pdfBytes)
  if (!sniff.ok) {
    if (sniff.reason === 'too_large') throw new ApiError(413, 'PAYLOAD_TOO_LARGE', `A PDF is at most ${LIMITS.extraction.pdfBytes / 1024 / 1024} MiB.`)
    throw new ApiError(422, 'VALIDATION_FAILED', PDF_REFUSALS[sniff.reason], { details: { reason: sniff.reason } })
  }
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > LIMITS.extraction.pdfPages) {
    throw new ApiError(422, 'VALIDATION_FAILED', `A PDF has 1–${LIMITS.extraction.pdfPages} pages.`, { fields: [{ path: 'X-Page-Count', message: `1–${LIMITS.extraction.pdfPages} pages` }] })
  }
  return putDocument(deps, userId, evaluationId, caseKey, { mediaType: 'application/pdf', bytes, pageCount, delivery: 'pdf_native' }, ifMatch, requestId)
}

/**
 * The hearing's copy (spec 04 §5): the owner, or a juror (signed in or guest) with a live session
 * on this hearing, the same rule as the worksheet. Anyone else gets the same 404.
 */
export async function getRunDocument(deps: Deps, userId: string, runId: string, caseKey: string): Promise<{ kind: 'text'; text: string } | { kind: 'pdf'; bytes: Uint8Array<ArrayBuffer> }> {
  const access = await loadRunAccess(deps.db, runId, userId)
  if (access.role !== 'owner') {
    if (!access.session || access.session.status === 'revoked') throw notFound()
    // D-91: a juror reads only the documents of questions on their own worksheet (the review's allowlist).
    const assignment = JSON.parse(access.session.assignment_json) as Array<{ caseKey: string }>
    if (!assignment.some((item) => item.caseKey === caseKey)) throw notFound()
  }
  // D-91: documents are big; besides the 120 reads a minute, at most 30 document reads a minute per caller.
  const reads = await hitRateLimit(deps.db, `document-read:${userId}`, DOCUMENT_READS_PER_MINUTE, deps.now())
  if (!reads.allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many document downloads in a minute. Try again shortly.', { retryAfterSeconds: reads.retryAfterSeconds })
  const row = await deps.db
    .prepare('SELECT d.blob_id, b.media_type FROM run_documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.run_id = ? AND d.case_key = ?')
    .bind(runId, caseKey)
    .first<{ blob_id: string; media_type: string }>()
  if (!row) throw notFound()
  const base64 = await readBlobBase64(deps.db, row.blob_id)
  if (base64 === null) throw new ApiError(404, 'NOT_FOUND', 'Source file not restored.', { details: { reason: 'document_not_restored' } })
  const bytes = base64ToBytes(base64)
  return row.media_type === 'application/pdf' ? { kind: 'pdf', bytes } : { kind: 'text', text: new TextDecoder().decode(bytes) }
}

export async function deleteDocument(deps: Deps, userId: string, evaluationId: string, caseKey: string, ifMatch: number, requestId: string) {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  requireOwner(access)
  if (access.evaluation.revision !== ifMatch) throw revisionConflict()
  const db = deps.db
  const now = deps.now()
  const current = (await listDraftDocuments(db, evaluationId)).filter((document) => document.caseKey !== caseKey)
  const nextDraft = withDocumentRefs(parseStoredDraft(access.evaluation), current)
  try {
    await runGuarded(db, 'document.remove', cond('EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL) AND EXISTS (SELECT 1 FROM evaluation_documents WHERE evaluation_id = ? AND case_key = ?)', evaluationId, userId, ifMatch, evaluationId, caseKey), [
      db.prepare('DELETE FROM evaluation_documents WHERE evaluation_id = ? AND case_key = ?').bind(evaluationId, caseKey),
      db.prepare('UPDATE evaluations SET draft_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?').bind(JSON.stringify(nextDraft), now, evaluationId),
      auditStatement(db, { eventType: 'document.remove', requestId, outcome: 'ok', actorUserId: userId, evaluationId }, now),
    ])
  } catch (error) {
    if (error instanceof GuardFailed) {
      const row = await db.prepare('SELECT 1 AS n FROM evaluation_documents WHERE evaluation_id = ? AND case_key = ?').bind(evaluationId, caseKey).first()
      if (!row) throw notFound()
      throw revisionConflict()
    }
    throw error
  }
  return { revision: ifMatch + 1, draft: nextDraft }
}

/** The owner's draft copy: text as JSON, a PDF as bytes. */
export async function getDraftDocument(deps: Deps, userId: string, evaluationId: string, caseKey: string): Promise<{ kind: 'text'; text: string } | { kind: 'pdf'; bytes: Uint8Array<ArrayBuffer> }> {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  requireOwner(access)
  const row = await deps.db
    .prepare('SELECT d.blob_id, b.media_type FROM evaluation_documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.evaluation_id = ? AND d.case_key = ?')
    .bind(evaluationId, caseKey)
    .first<{ blob_id: string; media_type: string }>()
  if (!row) throw notFound()
  const base64 = await readBlobBase64(deps.db, row.blob_id)
  if (base64 === null) throw new ApiError(404, 'NOT_FOUND', 'Source file not restored. Upload the same file again to restore it.', { details: { reason: 'document_not_restored' } })
  const bytes = base64ToBytes(base64)
  return row.media_type === 'application/pdf' ? { kind: 'pdf', bytes } : { kind: 'text', text: new TextDecoder().decode(bytes) }
}

// ---------------------------------------------------------------------------
// Draft writes, admission and maintenance
// ---------------------------------------------------------------------------

/** Statements that drop draft documents of questions the draft no longer has. */
export function orphanDocumentStatements(db: D1Database, evaluationId: string, caseKeys: readonly string[]): D1PreparedStatement[] {
  return [db.prepare(`DELETE FROM evaluation_documents WHERE evaluation_id = ? AND case_key NOT IN (${caseKeys.map(() => '?').join(',') || "''"})`).bind(evaluationId, ...caseKeys)]
}

/**
 * Admission (spec 04 §4.3): copy every question's draft document to the hearing, in the batch
 * that writes the snapshot. The guards make the hearing refuse to start if any draft document
 * changed after the snapshot was built.
 */
export function admissionDocuments(db: D1Database, evaluationId: string, runId: string, cases: ReadonlyArray<{ key: string; kitFields?: unknown }>, now: number) {
  const refs = cases.flatMap((testCase) => {
    const fields = testCase.kitFields as ExtractionFields | undefined
    return fields?.kind === 'extraction' && fields.document ? [{ caseKey: testCase.key, ref: fields.document }] : []
  })
  const conditions = refs.map(({ caseKey, ref }) =>
    cond(
      `EXISTS (SELECT 1 FROM evaluation_documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.evaluation_id = ? AND d.case_key = ? AND b.sha256 = ? AND d.delivery = ?
         AND (SELECT COUNT(*) FROM document_blob_chunks c WHERE c.blob_id = b.id) = b.chunk_count)`,
      evaluationId,
      caseKey,
      ref.sha256,
      ref.delivery,
    ),
  )
  const statements = refs.map(({ caseKey, ref }) =>
    db
      .prepare(
        `INSERT INTO run_documents (run_id, case_key, blob_id, sha256, delivery, created_at)
         SELECT ?, d.case_key, d.blob_id, b.sha256, d.delivery, ? FROM evaluation_documents d JOIN document_blobs b ON b.id = d.blob_id
         WHERE d.evaluation_id = ? AND d.case_key = ? AND b.sha256 = ?`,
      )
      .bind(runId, now, evaluationId, caseKey, ref.sha256),
  )
  return { conditions, statements }
}

/** Questions whose draft document is missing or whose PDF bytes were not restored (spec 04 §4.6). */
export async function unavailableDocuments(db: D1Database, evaluationId: string, cases: ReadonlyArray<{ key: string; kitFields?: unknown }>): Promise<string[]> {
  const documents = new Map((await listDraftDocuments(db, evaluationId)).map((document) => [document.caseKey, document]))
  return cases.flatMap((testCase) => {
    const ref = (testCase.kitFields as ExtractionFields | undefined)?.document
    if (!ref) return []
    const found = documents.get(testCase.key)
    return found && found.available && found.sha256 === ref.sha256 ? [] : [testCase.key]
  })
}

/**
 * Deletes up to 20 blobs no draft or hearing references, older than 10 minutes, and gives their
 * bytes back to both buckets in the same guarded batch. Idempotent.
 */
export async function sweepUnreferencedDocumentBlobs(deps: Pick<Deps, 'db' | 'now' | 'newId'>): Promise<number> {
  const db = deps.db
  const now = deps.now()
  const candidates = await db
    .prepare(
      `SELECT id, owner_user_id, byte_length, media_type, page_count, sha256, chunk_count,
         (SELECT COUNT(*) FROM document_blob_chunks c WHERE c.blob_id = b.id) AS chunks_present
       FROM document_blobs b
       WHERE created_at <= ? AND NOT EXISTS (SELECT 1 FROM evaluation_documents d WHERE d.blob_id = b.id) AND NOT EXISTS (SELECT 1 FROM run_documents r WHERE r.blob_id = b.id)
       ORDER BY created_at LIMIT ?`,
    )
    .bind(now - SWEEP_MIN_AGE_MS, SWEEP_BATCH)
    .all<{ id: string; owner_user_id: string; byte_length: number; media_type: string; page_count: number | null; sha256: string; chunk_count: number; chunks_present: number }>()
  let swept = 0
  for (const blob of candidates.results) {
    try {
      await runGuarded(
        db,
        'document.sweep',
        cond('EXISTS (SELECT 1 FROM document_blobs WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM evaluation_documents WHERE blob_id = ?) AND NOT EXISTS (SELECT 1 FROM run_documents WHERE blob_id = ?)', blob.id, blob.id, blob.id),
        [
          // D-91: whether the blob counted toward the buckets (all its chunks present) is decided inside this
          // batch, so a repair upload between the select and the sweep can't leave the counters inflated.
          ...[`user:${blob.owner_user_id}`, 'global'].map((scope) =>
            db
              .prepare(
                `UPDATE document_storage_buckets SET used_bytes = MAX(0, used_bytes - ?) WHERE scope = ?
                   AND (SELECT COUNT(*) FROM document_blob_chunks WHERE blob_id = ?) = (SELECT chunk_count FROM document_blobs WHERE id = ?)`,
              )
              .bind(blob.byte_length, scope, blob.id, blob.id),
          ),
          db.prepare('DELETE FROM document_blob_chunks WHERE blob_id = ?').bind(blob.id),
          db.prepare('DELETE FROM document_blobs WHERE id = ?').bind(blob.id),
          auditStatement(db, { eventType: 'document.sweep', requestId: 'cron', outcome: 'ok', metadata: { mediaType: blob.media_type, byteLength: blob.byte_length, pageCount: blob.page_count, sha256Prefix: blob.sha256.slice(0, 8) } }, now),
        ],
      )
      swept++
    } catch (error) {
      if (!(error instanceof GuardFailed)) throw error
    }
  }
  return swept
}

/**
 * Restore (spec 04 §4.6): recompute both buckets from the restored blobs whose chunks are all
 * present; exported counters are never trusted.
 */
export function recomputeStorageStatements(db: D1Database, limits: { perUserBytes: number; globalBytes: number }): D1PreparedStatement[] {
  const complete = `SELECT owner_user_id, byte_length FROM document_blobs b WHERE (SELECT COUNT(*) FROM document_blob_chunks c WHERE c.blob_id = b.id) = b.chunk_count`
  return [
    db.prepare('DELETE FROM document_storage_buckets'),
    db
      .prepare(`INSERT INTO document_storage_buckets (scope, used_bytes, limit_bytes) SELECT 'user:' || owner_user_id, SUM(byte_length), MAX(?, SUM(byte_length)) FROM (${complete}) GROUP BY owner_user_id`)
      .bind(limits.perUserBytes),
    db.prepare(`INSERT INTO document_storage_buckets (scope, used_bytes, limit_bytes) SELECT 'global', SUM(byte_length), MAX(?, SUM(byte_length)) FROM (${complete}) HAVING COUNT(*) > 0`).bind(limits.globalBytes),
  ]
}
