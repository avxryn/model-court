/**
 * Scenario versions of a case (spec 02, D-68): which hearings asked the same
 * questions, and what changed between them. Computed on read from the
 * immutable `snapshot_json`, so nothing is stored or backfilled.
 */

import type { z } from 'zod'
import { sha256Hex } from '../../domain/canonical'
import { draftInputSchema, isImported, type Configuration, type Draft, type duplicateEvaluationSchema, type restoreDraftSchema } from '../../domain/contracts'
import { defaultModelKeys, makeExampleDraft } from '../../domain/example'
import { LIMITS } from '../../domain/limits'
import { SCENARIO_HASH_VERSION, diffIsEmpty, diffParties, diffScenarios, partyFingerprint, questionHashes, scenarioHash, scenarioSourceOfDraft, scenarioSourceOfSnapshot, type PartyChange, type ScenarioDiff } from '../../domain/scenario'
import { isImportedSnapshot, type RunSnapshot, type SnapshotConfiguration } from '../../domain/snapshot'
import type { RunStatus } from '../../domain/transitions'
import { loadEvaluationAccess, type EvaluationRow } from '../access'
import { auditStatement, cond, GuardFailed, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, notFound, revisionConflict } from '../http'
import { idempotent, requestHash } from '../receipts'
import { caseQuotaError, configurationCapError, parseStoredDraft, samplesCapError } from './evaluations'
import { parseSnapshot } from './runs'

export interface HearingPartyView {
  key: string
  label: string
  fingerprint: string
  source: 'model' | 'imported'
  provider: string | null
  modelId: string | null
}

export interface HearingVersionView {
  scenarioHash: string
  /** 1-based, display-only, in order of first appearance in the case. */
  scenarioVersion: number
  /** 1-based position of the hearing in the case, oldest first. */
  number: number
  partyCount: number
  /** Only once this hearing is unsealed (revealed or decided); before that, a count only. */
  parties: HearingPartyView[] | null
  /** Versus the previous unsealed hearing of the same version; only when this one is unsealed. */
  changes: PartyChange[] | null
}

export const isUnsealedStatus = (status: RunStatus) => status === 'revealed' || status === 'decided'

export interface VersionRunInput {
  id: string
  status: RunStatus
  created_at: number
  snapshot_json: string
}

export async function hearingParties(snapshot: RunSnapshot): Promise<HearingPartyView[]> {
  const hashes = await questionHashes(snapshot.cases)
  return Promise.all(
    snapshot.configurations.map(async (configuration) => ({
      key: configuration.key,
      label: configuration.label,
      fingerprint: await partyFingerprint(configuration, hashes),
      source: isImportedSnapshot(configuration) ? ('imported' as const) : ('model' as const),
      provider: isImportedSnapshot(configuration) ? null : configuration.provider,
      modelId: isImportedSnapshot(configuration) ? null : configuration.modelId,
    })),
  )
}

/** Versions for a case's hearings (any order in, keyed by run id) and where the draft stands. */
export async function caseVersions(runs: readonly VersionRunInput[], draft: Draft) {
  const oldestFirst = [...runs].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
  const versionByHash = new Map<string, number>()
  const byRun = new Map<string, HearingVersionView>()
  const lastUnsealed = new Map<string, RunSnapshot>()
  let latest: RunSnapshot | null = null
  for (const [index, run] of oldestFirst.entries()) {
    const snapshot = parseSnapshot(run.snapshot_json)
    latest = snapshot
    const hash = await scenarioHash(scenarioSourceOfSnapshot(snapshot))
    if (!versionByHash.has(hash)) versionByHash.set(hash, versionByHash.size + 1)
    const unsealed = isUnsealedStatus(run.status)
    const previous = lastUnsealed.get(hash)
    byRun.set(run.id, {
      scenarioHash: hash,
      scenarioVersion: versionByHash.get(hash)!,
      number: index + 1,
      partyCount: snapshot.configurations.length,
      parties: unsealed ? await hearingParties(snapshot) : null,
      changes: unsealed && previous ? diffParties(previous.configurations, snapshot.configurations) : null,
    })
    if (unsealed) lastUnsealed.set(hash, snapshot)
  }
  const draftScenarioHash = await scenarioHash(scenarioSourceOfDraft(draft))
  const draftScenarioVersion = versionByHash.get(draftScenarioHash) ?? null
  // "What changed" between the newest hearing's questions and the draft, when they differ.
  let draftDiff: ScenarioDiff | null = null
  if (latest && draftScenarioVersion === null) {
    const diff = await diffScenarios(scenarioSourceOfSnapshot(latest), scenarioSourceOfDraft(draft))
    draftDiff = diffIsEmpty(diff) ? null : diff
  }
  return { byRun, draftScenarioHash, draftScenarioVersion, nextScenarioVersion: versionByHash.size + 1, draftDiff }
}

// ---------------------------------------------------------------------------
// Restore a hearing's questions and/or parties into the draft (D-69)
// ---------------------------------------------------------------------------

/** Owner-only routes of spec 02 answer 404 to jurors too, like any resource they cannot see. */
export async function loadOwnedEvaluation(db: D1Database, evaluationId: string, userId: string) {
  const access = await loadEvaluationAccess(db, evaluationId, userId)
  if (access.role !== 'owner') throw notFound()
  return access.evaluation
}

export async function loadCaseRun(db: D1Database, evaluationId: string, runId: string) {
  const run = await db.prepare('SELECT id, status, snapshot_json, created_at FROM runs WHERE id = ? AND evaluation_id = ?').bind(runId, evaluationId).first<{ id: string; status: RunStatus; snapshot_json: string; created_at: number }>()
  if (!run) throw notFound()
  return run
}

/** A frozen party back to a draft party: drop the resolved route, adapter version, source and import hashes. */
export function draftConfiguration(configuration: SnapshotConfiguration): Configuration {
  if (isImportedSnapshot(configuration)) return { kind: 'imported', key: configuration.key, label: configuration.label, provenance: configuration.provenance }
  return { ...(configuration.kind ? { kind: configuration.kind } : {}), key: configuration.key, label: configuration.label, modelKey: configuration.modelKey, systemPrompt: configuration.systemPrompt, maxOutputTokens: configuration.maxOutputTokens }
}

/**
 * The draft after restoring from a snapshot. Questions bring the rubric (and a kit, once item 3
 * freezes one); parties bring the comparison mode and repeats.
 */
export function restoredDraftInput(current: Draft, snapshot: RunSnapshot, parts: { questions: boolean; parties: boolean }): Record<string, unknown> {
  const { schemaVersion: _version, ...next } = current as Draft & Record<string, unknown>
  if (parts.questions) {
    next.cases = snapshot.cases
    next.rubricVersion = snapshot.rubricVersion
    const kit = (snapshot as unknown as Record<string, unknown>).kit
    if (kit !== undefined) next.kit = kit
    else delete next.kit
  }
  if (parts.parties) {
    next.comparisonMode = snapshot.comparisonMode
    next.configurations = snapshot.configurations.map(draftConfiguration)
    if (snapshot.samplesPerAnswer) next.samplesPerAnswer = snapshot.samplesPerAnswer
    else delete next.samplesPerAnswer
  }
  // Repeats need a generated party (draft rule); a restore that leaves none drops them.
  if (next.samplesPerAnswer && (next.configurations as Configuration[]).every(isImported)) delete next.samplesPerAnswer
  return next
}

export async function restoreDraft(deps: Deps, userId: string, evaluationId: string, input: z.output<typeof restoreDraftSchema>, ifMatch: number, requestId: string) {
  const evaluation = await loadOwnedEvaluation(deps.db, evaluationId, userId)
  const run = await loadCaseRun(deps.db, evaluationId, input.fromRunId)
  if (evaluation.revision !== ifMatch) throw revisionConflict()
  const snapshot = parseSnapshot(run.snapshot_json)
  const parsed = draftInputSchema.safeParse(restoredDraftInput(parseStoredDraft(evaluation), snapshot, input))
  if (!parsed.success) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'This hearing’s setup cannot be restored into a draft as it is.', { fields: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) })
  }
  const capError = configurationCapError(deps, parsed.data.configurations.length) ?? samplesCapError(deps, parsed.data.samplesPerAnswer)
  if (capError) throw capError
  const draft: Draft = { schemaVersion: 1, ...parsed.data }
  const db = deps.db
  const now = deps.now()
  const caseKeys = draft.cases.map((testCase) => testCase.key)
  // Imported parties keep their exact frozen answers, copied byte for byte from the hearing.
  const restoredImported = input.parties ? snapshot.configurations.filter(isImportedSnapshot).map((configuration) => configuration.key) : []
  const statements: D1PreparedStatement[] = [
    db.prepare('UPDATE evaluations SET draft_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?').bind(JSON.stringify(draft), now, evaluationId),
    ...restoredImported.flatMap((configurationKey) => [
      db.prepare('DELETE FROM evaluation_imports WHERE evaluation_id = ? AND configuration_key = ?').bind(evaluationId, configurationKey),
      db
        .prepare(
          `INSERT INTO evaluation_imports (evaluation_id, configuration_key, case_key, text, text_sha256, byte_length, created_at, updated_at)
           SELECT ?, configuration_key, case_key, text, text_sha256, byte_length, ?, ? FROM run_imported_outputs
           WHERE run_id = ? AND configuration_key = ? AND case_key IN (${caseKeys.map(() => '?').join(',')})`,
        )
        .bind(evaluationId, now, now, run.id, configurationKey, ...caseKeys),
    ]),
    auditStatement(db, { eventType: 'evaluation.restore', requestId, outcome: 'ok', actorUserId: userId, evaluationId, runId: run.id, metadata: { fromRunId: run.id, questions: input.questions, parties: input.parties } }, now),
  ]
  try {
    await runGuarded(db, 'evaluation.restore', cond('EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND owner_user_id = ? AND revision = ? AND deleted_at IS NULL)', evaluationId, userId, ifMatch), statements)
  } catch (error) {
    if (error instanceof GuardFailed) throw revisionConflict()
    throw error
  }
  return { revision: ifMatch + 1, draft, imports: await loadDraftImports(db, evaluationId) }
}

export async function loadDraftImports(db: D1Database, evaluationId: string) {
  return (
    await db
      .prepare('SELECT configuration_key, case_key, text, text_sha256, byte_length, updated_at FROM evaluation_imports WHERE evaluation_id = ? ORDER BY configuration_key, case_key')
      .bind(evaluationId)
      .all<{ configuration_key: string; case_key: string; text: string; text_sha256: string; byte_length: number; updated_at: number }>()
  ).results.map((row) => ({ configurationKey: row.configuration_key, caseKey: row.case_key, text: row.text, sha256: row.text_sha256, byteLength: row.byte_length, updatedAt: row.updated_at }))
}

// ---------------------------------------------------------------------------
// Copies and scenario files (D-71)
// ---------------------------------------------------------------------------

/** The owner view's origin line and live copy count. A duplicate's source may since be deleted or purged. */
export async function caseOrigin(db: D1Database, evaluation: EvaluationRow) {
  const copies = await db.prepare('SELECT COUNT(*) AS n FROM evaluations WHERE origin_evaluation_id = ? AND owner_user_id = ? AND deleted_at IS NULL').bind(evaluation.id, evaluation.owner_user_id).first<{ n: number }>()
  let origin: { kind: NonNullable<EvaluationRow['origin_kind']>; fromEvaluationId: string | null; fromRunId: string | null; scenarioHash: string | null; sourceDeleted: boolean } | null = null
  if (evaluation.origin_kind) {
    const source = evaluation.origin_evaluation_id
      ? await db.prepare('SELECT 1 AS ok FROM evaluations WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').bind(evaluation.origin_evaluation_id, evaluation.owner_user_id).first()
      : null
    origin = {
      kind: evaluation.origin_kind,
      fromEvaluationId: evaluation.origin_evaluation_id ?? null,
      fromRunId: evaluation.origin_run_id ?? null,
      scenarioHash: evaluation.origin_scenario_hash ?? null,
      sourceDeleted: evaluation.origin_kind === 'duplicate' && !source,
    }
  }
  return { origin, copyCount: Number(copies?.n ?? 0) }
}

/** The setup a copy or export starts from: the draft, or one hearing's frozen snapshot stripped back to a draft. */
async function sourceSetup(db: D1Database, evaluation: EvaluationRow, fromRunId: string | undefined) {
  const draft = parseStoredDraft(evaluation)
  if (!fromRunId) {
    const imports = (await db.prepare('SELECT configuration_key, case_key, text, text_sha256, byte_length FROM evaluation_imports WHERE evaluation_id = ?').bind(evaluation.id).all<ImportRow>()).results
    return { draft, imports, snapshot: null as RunSnapshot | null }
  }
  const run = await loadCaseRun(db, evaluation.id, fromRunId)
  const snapshot = parseSnapshot(run.snapshot_json)
  const restored = restoredDraftInput(draft, snapshot, { questions: true, parties: true })
  const parsed = draftInputSchema.safeParse(restored)
  if (!parsed.success) throw new ApiError(422, 'VALIDATION_FAILED', 'This hearing’s setup cannot be copied into a draft as it is.')
  const imports = (await db.prepare('SELECT configuration_key, case_key, text, text_sha256, byte_length FROM run_imported_outputs WHERE run_id = ?').bind(run.id).all<ImportRow>()).results
  return { draft: { schemaVersion: 1 as const, ...parsed.data }, imports, snapshot }
}

interface ImportRow {
  configuration_key: string
  case_key: string
  text: string
  text_sha256: string
  byte_length: number
}

export async function duplicateEvaluation(deps: Deps, userId: string, evaluationId: string, input: z.output<typeof duplicateEvaluationSchema>, key: string, requestId: string) {
  const evaluation = await loadOwnedEvaluation(deps.db, evaluationId, userId)
  const operation = `evaluation.duplicate:${evaluationId}`
  const result = await idempotent(deps, { actorUserId: userId, idempotencyKey: key, operation, requestHash: await requestHash(operation, input) }, async (receipt) => {
    const db = deps.db
    const source = await sourceSetup(db, evaluation, input.fromRunId)
    // Fresh keys for every question and party; a key map carries imported answers across.
    const caseKeys = new Map(source.draft.cases.map((testCase) => [testCase.key, deps.newId()]))
    const partyKeys = new Map(source.draft.configurations.map((party) => [party.key, deps.newId()]))
    const cases = source.draft.cases.map((testCase) => ({ ...testCase, key: caseKeys.get(testCase.key)! }))
    const { schemaVersion: _version, ...rest } = source.draft as Draft & Record<string, unknown>
    let next: Record<string, unknown> = { ...rest, cases }
    if (input.includeParties) {
      next.configurations = source.draft.configurations.map((party) => ({ ...party, key: partyKeys.get(party.key)! }))
    } else {
      const example = makeExampleDraft(deps.newId, defaultModelKeys(deps.routes))
      next = { ...next, comparisonMode: example.comparisonMode, configurations: example.configurations }
      delete next.samplesPerAnswer
    }
    const parsed = draftInputSchema.safeParse(next)
    if (!parsed.success) throw new ApiError(422, 'VALIDATION_FAILED', 'This setup cannot be copied into a new case as it is.')
    const capError = configurationCapError(deps, parsed.data.configurations.length) ?? samplesCapError(deps, parsed.data.samplesPerAnswer)
    if (capError) throw capError
    const draft: Draft = { schemaVersion: 1, ...parsed.data }
    const imported = new Set(draft.configurations.filter(isImported).map((party) => party.key))
    const copiedImports = input.includeImportedAnswers
      ? source.imports
          .map((row) => ({ ...row, configuration_key: partyKeys.get(row.configuration_key), case_key: caseKeys.get(row.case_key) }))
          .filter((row): row is ImportRow => !!row.configuration_key && !!row.case_key && imported.has(row.configuration_key))
      : []
    // The copied text must still be what was hashed.
    for (const row of copiedImports) if ((await sha256Hex(row.text)) !== row.text_sha256) throw new ApiError(500, 'INTERNAL', 'A copied answer did not match its fingerprint.')
    const now = deps.now()
    const id = deps.newId()
    const scenario = await scenarioHash(scenarioSourceOfDraft(draft))
    const response = { status: 201 as const, data: { id, revision: 1 } }
    try {
      await runGuarded(db, 'evaluation.duplicate', cond('(SELECT COUNT(*) FROM evaluations WHERE owner_user_id = ? AND deleted_at IS NULL) < ?', userId, LIMITS.ownEvaluationsPerUser), [
        receipt(response, id),
        db
          .prepare(
            `INSERT INTO evaluations (id, owner_user_id, title, task_description, draft_json, revision, created_at, updated_at, origin_kind, origin_evaluation_id, origin_run_id, origin_scenario_hash)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'duplicate', ?, ?, ?)`,
          )
          .bind(id, userId, input.title, evaluation.task_description, JSON.stringify(draft), now, now, evaluationId, input.fromRunId ?? null, scenario),
        ...copiedImports.map((row) =>
          db
            .prepare('INSERT INTO evaluation_imports (evaluation_id, configuration_key, case_key, text, text_sha256, byte_length, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(id, row.configuration_key, row.case_key, row.text, row.text_sha256, row.byte_length, now, now),
        ),
        auditStatement(db, { eventType: 'evaluation.duplicate', requestId, outcome: 'ok', actorUserId: userId, evaluationId: id, metadata: { fromEvaluationId: evaluationId, fromRunId: input.fromRunId ?? null, includeParties: input.includeParties, importedAnswers: copiedImports.length } }, now),
      ])
    } catch (error) {
      if (error instanceof GuardFailed) throw caseQuotaError()
      throw error
    }
    return response
  })
  return result
}

/**
 * A scenario file (spec 02 §6.5): questions, rubric and template, and the parties only when asked.
 * Never any id, key, credential, imported answer, testimony, rating or judgment.
 */
export async function exportScenario(deps: Deps, userId: string, evaluationId: string, fromRunId: string | undefined, includeParties: boolean, requestId: string) {
  const evaluation = await loadOwnedEvaluation(deps.db, evaluationId, userId)
  const source = await sourceSetup(deps.db, evaluation, fromRunId)
  const scenarioSource = source.snapshot ? scenarioSourceOfSnapshot(source.snapshot) : scenarioSourceOfDraft(source.draft)
  const kit = (source.snapshot ?? source.draft) as unknown as { kit?: unknown }
  const models = source.draft.configurations.filter((party) => !isImported(party)) as Array<Extract<Configuration, { modelKey: string }>>
  const leftOut = source.draft.configurations.length - models.length
  const file = {
    format: 'model-court-scenario' as const,
    formatVersion: 1 as const,
    exportedAt: new Date(deps.now()).toISOString(),
    scenarioHashVersion: SCENARIO_HASH_VERSION,
    scenarioHash: await scenarioHash(scenarioSource),
    title: evaluation.title,
    taskDescription: evaluation.task_description,
    rubricVersion: scenarioSource.rubricVersion,
    messageTemplateVersion: scenarioSource.messageTemplateVersion,
    ...(kit.kit !== undefined ? { kit: kit.kit } : {}),
    // Every question field but the key, so fields a task kit adds travel too.
    questions: source.draft.cases.map(({ key: _key, ...question }) => question),
    ...(includeParties
      ? {
          comparisonMode: source.draft.comparisonMode,
          parties: models.map((party) => {
            const route = deps.routes.find((r) => r.key === party.modelKey)
            return { label: party.label, modelKey: party.modelKey, provider: route?.provider ?? '', modelId: route?.modelId ?? '', systemPrompt: party.systemPrompt }
          }),
          ...(leftOut > 0 ? { importedPartiesLeftOut: leftOut } : {}),
        }
      : {}),
  }
  await auditStatement(deps.db, { eventType: 'scenario.export', requestId, outcome: 'ok', actorUserId: userId, evaluationId, ...(fromRunId ? { runId: fromRunId } : {}), metadata: { fromRunId: fromRunId ?? null, includeParties } }, deps.now()).run()
  return { file, filename: `${docketOf(evaluationId)}-scenario.json` }
}

/** Same docket number the UI shows (src/lib/court.ts). */
function docketOf(evaluationId: string): string {
  const hex = evaluationId.replace(/[^0-9a-f]/gi, '').toUpperCase().padEnd(8, '0')
  return `MC-${hex.slice(0, 4)}-${hex.slice(4, 8)}`
}
