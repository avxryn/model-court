/**
 * Sources of grounded questions (spec 05 §4–5, D-93).
 *
 * Text lives in `evaluation_sources` (draft, replaceable per question) and `run_sources` (one
 * hearing's copy, immutable), never in the draft or snapshot JSON. A question's
 * `kitFields.sources` in the stored draft mirrors its rows as `{number, sha256, byteLength}`:
 * every draft write sets it from the table (`withSourceRefs`), so the question hash, the scenario
 * hash and the snapshot hash commit to the exact text. Source text and origin notes never reach a
 * log, an audit row, a notice, a URL or a job payload (audits carry counts only).
 */

import type { Draft, SourceInput } from '../../domain/contracts'
import { sourceSha256, type GroundedSource, type PromptSource, type SourceRef } from '../../domain/grounded/sources'
import { GROUNDED_DEFAULT_FIELDS, type GroundedFields } from '../../domain/kits/grounded'
import { LIMITS } from '../../domain/limits'
import { codePointLength, utf8ByteLength } from '../../domain/text'
import { loadEvaluationAccess, requireOwner } from '../access'
import { auditStatement, cond, GuardFailed, runGuarded, type Condition } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, notFound, revisionConflict } from '../http'
import { parseStoredDraft } from './evaluations'

const G = LIMITS.grounded

export interface StoredSource extends GroundedSource {
  sha256: string
  byteLength: number
  updatedAt: number
}

interface SourceRow {
  case_key: string
  number: number
  title: string | null
  origin: string | null
  text: string
  sha256: string
  byte_length: number
  updated_at?: number
}

function storedOf(row: SourceRow): StoredSource {
  return { number: row.number, title: row.title, origin: row.origin, text: row.text, sha256: row.sha256, byteLength: row.byte_length, updatedAt: row.updated_at ?? 0 }
}

function groupByCase(rows: readonly SourceRow[]): Map<string, StoredSource[]> {
  const out = new Map<string, StoredSource[]>()
  for (const row of rows) out.set(row.case_key, [...(out.get(row.case_key) ?? []), storedOf(row)])
  for (const list of out.values()) list.sort((a, b) => a.number - b.number)
  return out
}

/** The draft's sources per question, in order. */
export async function listDraftSources(db: D1Database, evaluationId: string): Promise<Map<string, StoredSource[]>> {
  const rows = await db.prepare('SELECT case_key, number, title, origin, text, sha256, byte_length, updated_at FROM evaluation_sources WHERE evaluation_id = ? ORDER BY case_key, number').bind(evaluationId).all<SourceRow>()
  return groupByCase(rows.results)
}

/** A hearing's frozen sources per question, in order (with origin notes: owner-side readers only). */
export async function listRunSources(db: D1Database, runId: string): Promise<Map<string, StoredSource[]>> {
  const rows = await db.prepare('SELECT case_key, number, title, origin, text, sha256, byte_length, created_at AS updated_at FROM run_sources WHERE run_id = ? ORDER BY case_key, number').bind(runId).all<SourceRow>()
  return groupByCase(rows.results)
}

function refsOf(sources: ReadonlyArray<Pick<StoredSource, 'number' | 'sha256' | 'byteLength'>>): SourceRef[] {
  return sources.map((source) => ({ number: source.number, sha256: source.sha256, byteLength: source.byteLength }))
}

/**
 * The draft with each grounded question's `kitFields` completed (the default key when absent) and
 * its `sources` set from the table (or removed). Other kits' drafts are untouched. Pure.
 */
export function withSourceRefs(draft: Draft, sources: ReadonlyMap<string, ReadonlyArray<Pick<StoredSource, 'number' | 'sha256' | 'byteLength'>>>): Draft {
  if (draft.kit?.version !== 'grounded-v1') return draft
  return {
    ...draft,
    cases: draft.cases.map((testCase) => {
      const fields = testCase.kitFields as GroundedFields | undefined
      const { sources: _old, ...rest } = fields?.kind === 'grounded' ? fields : GROUNDED_DEFAULT_FIELDS
      const found = sources.get(testCase.key) ?? []
      const next: GroundedFields = found.length > 0 ? { ...rest, sources: refsOf(found) } : rest
      return { ...testCase, kitFields: next }
    }),
  }
}

async function storedFromInput(sources: readonly SourceInput[], now: number): Promise<StoredSource[]> {
  return Promise.all(
    sources.map(async (input) => {
      const source: GroundedSource = { number: input.number, title: input.title ?? null, origin: input.origin ?? null, text: input.text }
      return { ...source, sha256: await sourceSha256(source), byteLength: utf8ByteLength(source.text), updatedAt: now }
    }),
  )
}

function chars(sources: ReadonlyArray<Pick<GroundedSource, 'text'>>): number {
  return sources.reduce((sum, source) => sum + codePointLength(source.text), 0)
}

/** Owner view (spec 05 §5.2): every question's sources, with origin and hash, and the case total. */
export async function ownerSourcesView(db: D1Database, evaluationId: string) {
  const byCase = await listDraftSources(db, evaluationId)
  return {
    sources: [...byCase.entries()].map(([caseKey, items]) => ({ caseKey, items: items.map(({ byteLength: _bytes, ...item }) => item) })),
    sourceTotals: { caseChars: [...byCase.values()].reduce((sum, items) => sum + chars(items), 0), limit: G.caseChars },
  }
}

function requireGroundedQuestion(draft: Draft, caseKey: string): void {
  if (draft.kit?.version !== 'grounded-v1') {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Save this case as "Answers from sources" first.', { fields: [{ path: 'caseKey', message: 'Not an answers-from-sources case in the saved draft' }] })
  }
  if (!draft.cases.some((testCase) => testCase.key === caseKey)) throw notFound()
}

function withRequiredSources(draft: Draft, caseKey: string, required: number[]): Draft {
  return {
    ...draft,
    cases: draft.cases.map((testCase) => {
      if (testCase.key !== caseKey) return testCase
      const fields = testCase.kitFields as GroundedFields | undefined
      const base = fields?.kind === 'grounded' ? fields : GROUNDED_DEFAULT_FIELDS
      if (base.answerable === 'no' && required.length > 0) {
        throw new ApiError(422, 'VALIDATION_FAILED', 'A question the sources cannot answer has no required sources.', { fields: [{ path: 'requiredSources', message: 'Clear them, or mark the question answerable' }] })
      }
      return { ...testCase, kitFields: { ...base, requiredSources: required } }
    }),
  }
}

/** Replaces one question's sources and bumps the revision (spec 05 §5.1). */
/** Spec 05 §5.1 (D-98): anyone but the owner, a juror included, gets the same 404 as a missing resource. */
async function ownerAccess(deps: Deps, evaluationId: string, userId: string) {
  const access = await loadEvaluationAccess(deps.db, evaluationId, userId)
  if (access.role !== 'owner') throw notFound()
  requireOwner(access)
  return access
}

export async function putSources(deps: Deps, userId: string, evaluationId: string, caseKey: string, input: { sources: SourceInput[]; requiredSources?: number[] }, ifMatch: number, requestId: string) {
  const access = await ownerAccess(deps, evaluationId, userId)
  const draft = parseStoredDraft(access.evaluation)
  requireGroundedQuestion(draft, caseKey)
  if (access.evaluation.revision !== ifMatch) throw revisionConflict()
  const db = deps.db
  const now = deps.now()
  const rows = await storedFromInput(input.sources, now)
  const current = await listDraftSources(db, evaluationId)
  const caseKeys = new Set(draft.cases.map((testCase) => testCase.key))
  const others = [...current.entries()].filter(([key]) => key !== caseKey && caseKeys.has(key)).reduce((sum, [, items]) => sum + chars(items), 0)
  if (others + chars(rows) > G.caseChars) {
    throw new ApiError(422, 'VALIDATION_FAILED', `The case's sources would be ${(others + chars(rows)).toLocaleString('en-US')} characters; the limit is ${G.caseChars.toLocaleString('en-US')} for all questions together.`, {
      fields: [{ path: 'sources', message: `At most ${G.caseChars.toLocaleString('en-US')} characters across the case` }],
    })
  }
  const next = new Map(current)
  next.set(caseKey, rows)
  // D-95: the judge's renumbered "A good answer cites", written in the same batch as the sources.
  const required = input.requiredSources ? [...new Set(input.requiredSources)].sort((a, b) => a - b) : null
  const keyed = required ? withRequiredSources(draft, caseKey, required) : draft
  const nextDraft = withSourceRefs(keyed, next)
  const draftJson = JSON.stringify(nextDraft)
  if (utf8ByteLength(draftJson) > LIMITS.draftJsonBytes) throw new ApiError(422, 'VALIDATION_FAILED', 'Draft exceeds 96 KiB')
  try {
    await runGuarded(db, 'evaluation.sources.put', cond('EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL)', evaluationId, userId, ifMatch), [
      db.prepare('DELETE FROM evaluation_sources WHERE evaluation_id = ? AND case_key = ?').bind(evaluationId, caseKey),
      ...rows.map((row) =>
        db
          .prepare('INSERT INTO evaluation_sources (evaluation_id, case_key, number, title, origin, text, sha256, byte_length, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(evaluationId, caseKey, row.number, row.title, row.origin, row.text, row.sha256, row.byteLength, now, now),
      ),
      db.prepare('UPDATE evaluations SET draft_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?').bind(draftJson, now, evaluationId),
      // Counts only: never a title, note or text.
      auditStatement(db, { eventType: 'evaluation.sources.put', requestId, outcome: 'ok', actorUserId: userId, evaluationId, metadata: { caseKey, count: rows.length, chars: chars(rows) } }, now),
    ])
  } catch (error) {
    if (error instanceof GuardFailed) throw revisionConflict()
    throw error
  }
  return { revision: ifMatch + 1, sources: rows.map(({ byteLength: _bytes, ...row }) => row), draft: nextDraft }
}

export async function deleteSources(deps: Deps, userId: string, evaluationId: string, caseKey: string, ifMatch: number, requestId: string) {
  const access = await ownerAccess(deps, evaluationId, userId)
  if (access.evaluation.revision !== ifMatch) throw revisionConflict()
  const db = deps.db
  const now = deps.now()
  const current = await listDraftSources(db, evaluationId)
  if (!current.has(caseKey)) throw notFound()
  const next = new Map(current)
  next.delete(caseKey)
  const nextDraft = withSourceRefs(parseStoredDraft(access.evaluation), next)
  try {
    await runGuarded(db, 'evaluation.sources.delete', cond('EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL)', evaluationId, userId, ifMatch), [
      db.prepare('DELETE FROM evaluation_sources WHERE evaluation_id = ? AND case_key = ?').bind(evaluationId, caseKey),
      db.prepare('UPDATE evaluations SET draft_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?').bind(JSON.stringify(nextDraft), now, evaluationId),
      auditStatement(db, { eventType: 'evaluation.sources.delete', requestId, outcome: 'ok', actorUserId: userId, evaluationId, metadata: { caseKey, count: current.get(caseKey)!.length } }, now),
    ])
  } catch (error) {
    if (error instanceof GuardFailed) throw revisionConflict()
    throw error
  }
  return { revision: ifMatch + 1, draft: nextDraft }
}

// ---------------------------------------------------------------------------
// Draft writes, admission, restore and copies
// ---------------------------------------------------------------------------

/** Statements that drop draft sources of questions the draft no longer has. */
export function orphanSourceStatements(db: D1Database, evaluationId: string, caseKeys: readonly string[]): D1PreparedStatement[] {
  return [db.prepare(`DELETE FROM evaluation_sources WHERE evaluation_id = ? AND case_key NOT IN (${caseKeys.map(() => '?').join(',') || "''"})`).bind(evaluationId, ...caseKeys)]
}

function refsOfCase(testCase: { kitFields?: unknown }): SourceRef[] {
  const fields = testCase.kitFields as GroundedFields | undefined
  return fields?.kind === 'grounded' ? (fields.sources ?? []) : []
}

/**
 * Admission (spec 05 §4.5): copy every question's draft sources to the hearing in the batch that
 * writes the snapshot. The guards refuse the start if any source changed, was added or was
 * removed after the snapshot was built, so a hearing never freezes text its snapshot doesn't describe.
 */
export function admissionSources(db: D1Database, newId: () => string, evaluationId: string, runId: string, cases: ReadonlyArray<{ key: string; kitFields?: unknown }>, now: number): { conditions: Condition[]; statements: D1PreparedStatement[] } {
  const statements: D1PreparedStatement[] = []
  const expected: string[] = []
  const caseKeys: string[] = []
  for (const testCase of cases) {
    const refs = refsOfCase(testCase)
    if (refs.length === 0) continue
    caseKeys.push(testCase.key)
    for (const ref of refs) {
      expected.push(`${testCase.key}:${ref.number}:${ref.sha256}`)
      statements.push(
        db
          .prepare(
            `INSERT INTO run_sources (id, run_id, case_key, number, title, origin, text, sha256, byte_length, created_at)
             SELECT ?, ?, case_key, number, title, origin, text, sha256, byte_length, ? FROM evaluation_sources
             WHERE evaluation_id = ? AND case_key = ? AND number = ? AND sha256 = ?`,
          )
          .bind(newId(), runId, now, evaluationId, testCase.key, ref.number, ref.sha256),
      )
    }
  }
  if (caseKeys.length === 0) return { conditions: [], statements }
  // D-98: one set-equality guard with six bound values, whatever the number of sources (D1 binds at
  // most 100 values per statement, and the guard row carries every condition of the start). The
  // draft's rows for these questions must be exactly the expected (question, number, hash)
  // triples: none missing (the count), none different or extra (each row is in the list). Keys are
  // UUIDs, numbers digits and hashes hex, so the comma-delimited lists cannot collide.
  const keys = `,${caseKeys.join(',')},`
  const triples = `,${expected.join(',')},`
  const conditions = [
    cond(
      `NOT EXISTS (SELECT 1 FROM evaluation_sources e WHERE e.evaluation_id = ? AND instr(?, ',' || e.case_key || ',') > 0 AND instr(?, ',' || e.case_key || ':' || e.number || ':' || e.sha256 || ',') = 0)
       AND (SELECT COUNT(*) FROM evaluation_sources e WHERE e.evaluation_id = ? AND instr(?, ',' || e.case_key || ',') > 0) = ?`,
      evaluationId,
      keys,
      triples,
      evaluationId,
      keys,
      expected.length,
    ),
  ]
  return { conditions, statements }
}

/** Restore (spec 02, D-69): the draft takes the hearing's own sources for the restored questions. */
export function restoreSourceStatements(db: D1Database, evaluationId: string, runId: string, caseKeys: readonly string[], now: number): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM evaluation_sources WHERE evaluation_id = ?').bind(evaluationId),
    db
      .prepare(
        `INSERT INTO evaluation_sources (evaluation_id, case_key, number, title, origin, text, sha256, byte_length, created_at, updated_at)
         SELECT ?, case_key, number, title, origin, text, sha256, byte_length, ?, ? FROM run_sources WHERE run_id = ? AND case_key IN (${caseKeys.map(() => '?').join(',') || "''"})`,
      )
      .bind(evaluationId, now, now, runId, ...caseKeys),
  ]
}

/** A copy (D-71) takes the source's sources under the copy's new question keys. */
export function copySourceStatements(db: D1Database, evaluationId: string, sources: ReadonlyMap<string, readonly StoredSource[]>, now: number): D1PreparedStatement[] {
  return [...sources.entries()].flatMap(([caseKey, items]) =>
    items.map((item) =>
      db
        .prepare('INSERT INTO evaluation_sources (evaluation_id, case_key, number, title, origin, text, sha256, byte_length, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(evaluationId, caseKey, item.number, item.title, item.origin, item.text, item.sha256, item.byteLength, now, now),
    ),
  )
}

/**
 * The sources a check or a request may see for one question, verified against the refs the
 * snapshot commits to: every number present, every hash recomputed from the stored text. Null
 * when anything is missing or differs, so nothing unverified is ever sent or checked. Origin
 * notes are dropped here.
 */
export async function verifiedPromptSources(stored: readonly StoredSource[] | undefined, refs: readonly SourceRef[]): Promise<PromptSource[] | null> {
  if (refs.length === 0 || !stored || stored.length !== refs.length) return null
  const out: PromptSource[] = []
  for (const [index, ref] of refs.entries()) {
    const row = stored[index]
    if (!row || row.number !== ref.number || row.number !== index + 1) return null
    if ((await sourceSha256({ number: row.number, title: row.title, origin: row.origin, text: row.text })) !== ref.sha256) return null
    out.push({ number: row.number, title: row.title, text: row.text })
  }
  return out
}

/**
 * What the generation job sends for one question, read from the hearing's own copy after the
 * claim and checked against the snapshot. Null (a definite, unsent failure) on any mismatch.
 */
export async function loadRunPromptSources(db: D1Database, runId: string, caseKey: string, refs: readonly SourceRef[]): Promise<PromptSource[] | null> {
  const rows = await db.prepare('SELECT case_key, number, title, origin, text, sha256, byte_length FROM run_sources WHERE run_id = ? AND case_key = ? ORDER BY number').bind(runId, caseKey).all<SourceRow>()
  return verifiedPromptSources(rows.results.map(storedOf), refs)
}

export function sourceRefsOf(testCase: { kitFields?: unknown }): SourceRef[] {
  return refsOfCase(testCase)
}
