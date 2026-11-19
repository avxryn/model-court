/**
 * Certified record export (P1 "JSON export"; spec §16.3). Owner-only, after
 * reveal. Built from the same projection as revealed results, so it carries
 * no provider keys, ciphertext, credential IDs, invite tokens, session or
 * response IDs, or any user ID — jurors appear only by their stable labels.
 */

import { canonicalJson, CANONICALIZATION_VERSION, sha256Hex } from '../../domain/canonical'
import { toCsv, type CsvCell } from '../../domain/csv'
import { loadRunAccess, requireOwner } from '../access'
import { auditStatement } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, stateConflict } from '../http'
import { getResults } from './results'

export const RECORD_FORMAT = 'model-court-certified-record' as const
export const RECORD_FORMAT_VERSION = 1 as const

export type ExportFormat = 'json' | 'csv'

export function parseExportFormat(value: string | undefined): ExportFormat {
  if (value === undefined || value === '' || value === 'json') return 'json'
  if (value === 'csv') return 'csv'
  throw new ApiError(400, 'BAD_REQUEST', 'Export format must be "json" or "csv".')
}

type Results = Awaited<ReturnType<typeof getResults>>

function buildRecordBody(results: Results, evaluationId: string) {
  // Spec 03 (D-76): kit and check fields only when a kit or checks are in play, so every general
  // record keeps its JSON and contentSha256.
  const checksVersion = results.checks?.kitVersion ?? null
  return {
    format: RECORD_FORMAT,
    formatVersion: RECORD_FORMAT_VERSION,
    run: {
      runId: results.runId,
      evaluationId,
      evaluationTitle: results.evaluationTitle,
      status: results.status,
      comparisonMode: results.comparisonMode,
      createdAt: results.createdAt,
      revealedAt: results.revealedAt,
      // Only with repeats (D-65); each response then carries `samples`.
      ...(results.samplesPerAnswer > 1 ? { samplesPerAnswer: results.samplesPerAnswer } : {}),
    },
    versions: {
      snapshotHash: results.snapshotHash,
      canonicalization: CANONICALIZATION_VERSION,
      rubricVersion: results.rubricVersion,
      messageTemplateVersion: results.messageTemplateVersion,
      providerRegistryVersion: results.providerRegistryVersion,
      appCommit: results.appCommit,
      priceTableVersion: results.priceTable.version,
      ...(results.kit || checksVersion ? { kitVersion: results.kit?.version ?? checksVersion } : {}),
    },
    ...(results.kit ? { kit: results.kit } : {}),
    configurations: results.configurations,
    cases: results.cases.map((testCase, index) => ({
      number: index + 1,
      key: testCase.key,
      title: testCase.title,
      input: testCase.input,
      reference: testCase.reference,
      expectedBehavior: testCase.expectedBehavior,
      // Only when present, so records without a conversation keep their earlier fingerprint.
      ...(testCase.messages.length > 0 ? { messages: testCase.messages } : {}),
      // Only when tagged, so records of untagged hearings keep their earlier fingerprint.
      ...(testCase.language ? { language: testCase.language } : {}),
      ...(testCase.kitFields ? { kitFields: testCase.kitFields } : {}),
      eligible: testCase.eligible,
    })),
    responses: results.cases.flatMap((testCase) => testCase.responses.map((response) => ({ caseKey: testCase.key, ...response }))),
    ratings: results.cases.flatMap((testCase) =>
      testCase.judgments.map((judgment) => ({
        caseKey: testCase.key,
        configurationKey: judgment.configurationKey,
        juror: judgment.reviewer,
        contextType: judgment.contextType,
        correctness: judgment.correctness,
        completeness: judgment.completeness,
        grounding: judgment.grounding,
        note: judgment.note,
        suspectedIdentityClue: judgment.suspectedIdentityClue,
        // Spec 04 (D-87): only on extraction hearings, so other records keep their fingerprint.
        ...('fieldFlags' in judgment ? { fieldFlags: judgment.fieldFlags } : {}),
      })),
    ),
    findings: {
      plannedCaseCount: results.plannedCaseCount,
      eligibleCaseKeys: results.eligibleCaseKeys,
      excludedCaseKeys: results.excludedCaseKeys,
      cohorts: results.cohorts,
      disagreements: results.disagreements,
      coverage: results.coverage,
    },
    // Estimated at list prices (D-63); the provider bill is the authority.
    setupMetrics: { priceTable: results.priceTable, byConfiguration: results.setupMetrics },
    // Free automatic checks (spec 03): reported next to the findings, never part of them.
    ...(results.checks ? { checks: results.checks } : {}),
    // Spec 04 §5: authoring and wire schemas with their hash, answer keys, rules, document
    // metadata, text documents in full and the per-field table. PDF bytes are never embedded.
    ...('extraction' in results && results.extraction ? { extraction: results.extraction } : {}),
    verdicts: results.verdicts,
  }
}

export type CertifiedRecordBody = ReturnType<typeof buildRecordBody>

export interface CertifiedRecord extends CertifiedRecordBody {
  exportedAt: string
  certification: {
    /** SHA-256 of the canonical JSON of every field except `exportedAt` and `certification`. */
    contentSha256: string
    statement: string
  }
}

/** Deterministic for a given run state: exporting twice yields the same contentSha256. */
export async function certifyRecord(body: CertifiedRecordBody, exportedAt: number): Promise<CertifiedRecord> {
  const contentSha256 = await sha256Hex(canonicalJson(body))
  return {
    ...body,
    exportedAt: new Date(exportedAt).toISOString(),
    certification: {
      contentSha256,
      statement: `Exported from Model Court. Evidence is the immutable run snapshot ${body.versions.snapshotHash}; ratings are the reviews submitted before reveal, scored with ${body.versions.rubricVersion}.${body.checks ? ` Automatic checks (${body.versions.kitVersion}) are reported separately and are not part of the ratings.` : ''}`,
    },
  }
}

export const RECORD_CSV_HEADER = [
  'case_number',
  'case_title',
  'case_eligible',
  'configuration_label',
  'provider',
  'model_id',
  'response_status',
  'response_text',
  'juror',
  'juror_context',
  'correctness',
  'completeness',
  'grounding',
  'note',
  'suspected_identity_clue',
  'case_key',
  'configuration_key',
  'snapshot_hash',
  'rubric_version',
  'exported_at',
] as const

/** Spec 03 (D-76): appended after `exported_at`, only for hearings with automatic checks. Reasons stay in the JSON. */
export const RECORD_CSV_CHECK_COLUMNS = ['kit_version', 'checks_passed', 'checks_failed', 'checks_not_applicable', 'checks_failed_ids'] as const

/** Spec 04 §5: appended last, only for extraction hearings ("invented:/total;ambiguous:/dueDate"). */
export const RECORD_CSV_FLAG_COLUMNS = ['field_flags'] as const

function checkCells(record: CertifiedRecord, caseKey: string, configurationKey: string): CsvCell[] {
  const response = record.responses.find((r) => r.caseKey === caseKey && r.configurationKey === configurationKey) as { checks?: Array<{ checkId: string; status: string }> | null } | undefined
  const results = response?.checks ?? null
  if (!results) return [record.versions.kitVersion ?? null, null, null, null, null]
  const count = (status: string) => results.filter((result) => result.status === status).length
  return [record.versions.kitVersion ?? null, count('pass'), count('fail'), count('na'), results.filter((result) => result.status === 'fail').map((result) => result.checkId).join(';')]
}

/**
 * One row per rating; a response nobody rated (an excluded case) gets one row
 * with empty juror columns. Verdicts and cohort findings are in the JSON record.
 * Hearings with automatic checks append five columns (general records keep today's header).
 */
export function recordToCsv(record: CertifiedRecord): string {
  const withChecks = record.checks !== undefined
  const withFlags = 'extraction' in record && record.extraction !== undefined
  const rows: CsvCell[][] = []
  for (const testCase of record.cases) {
    for (const configuration of record.configurations) {
      const response = record.responses.find((r) => r.caseKey === testCase.key && r.configurationKey === configuration.key)
      const base: CsvCell[] = [testCase.number, testCase.title, testCase.eligible, configuration.label, configuration.provider, configuration.modelId, response?.status ?? 'pending', response?.text ?? '']
      const tail: CsvCell[] = [testCase.key, configuration.key, record.versions.snapshotHash, record.versions.rubricVersion, record.exportedAt, ...(withChecks ? checkCells(record, testCase.key, configuration.key) : [])]
      const ratings = record.ratings.filter((r) => r.caseKey === testCase.key && r.configurationKey === configuration.key)
      if (ratings.length === 0) rows.push([...base, null, null, null, null, null, null, null, ...tail, ...(withFlags ? [null] : [])])
      for (const rating of ratings) {
        const flags = withFlags ? [((rating as { fieldFlags?: Array<{ path: string; flag: string }> }).fieldFlags ?? []).map((flag) => `${flag.flag}:${flag.path}`).join(';')] : []
        rows.push([...base, rating.juror, rating.contextType, rating.correctness, rating.completeness, rating.grounding, rating.note, rating.suspectedIdentityClue, ...tail, ...flags])
      }
    }
  }
  return toCsv([...RECORD_CSV_HEADER, ...(withChecks ? RECORD_CSV_CHECK_COLUMNS : []), ...(withFlags ? RECORD_CSV_FLAG_COLUMNS : [])], rows)
}

export async function exportRun(deps: Deps, userId: string, runId: string, format: ExportFormat, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireOwner(access)
  if (access.run.status !== 'revealed' && access.run.status !== 'decided') {
    throw stateConflict('The record can be exported after you reveal the models.')
  }
  const results = await getResults(deps, userId, runId)
  const now = deps.now()
  const record = await certifyRecord(buildRecordBody(results, access.evaluation.id), now)
  await auditStatement(
    deps.db,
    { eventType: 'run.export', requestId, outcome: 'ok', actorUserId: userId, evaluationId: access.evaluation.id, runId, metadata: { format, contentSha256: record.certification.contentSha256 } },
    now,
  ).run()
  const filename = `model-court-record-${runId}.${format}`
  return format === 'json' ? { format, filename, record } : { format, filename, csv: recordToCsv(record) }
}
