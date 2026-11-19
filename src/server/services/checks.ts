/**
 * Automatic checks: storage and read projections (spec 03 §3.6–3.7, D-76).
 *
 * The only service module that names `testimony_checks` (with backup.ts and the migrations;
 * `checks-isolation.test.ts` enforces it). Checks run inside the guarded batch that accepts a
 * testimony, so a testimony and its results commit atomically or not at all. They are read only
 * by `getResults` (and through it the export), which refuses before unsealing: no check result,
 * count or parsed label leaves the server for any role before then.
 */

import type { CaseInput } from '../../domain/contracts'
import { KITS, kitFor, type KitTable } from '../../domain/kits/registry'
import { runChecks } from '../../domain/kits/runner'
import { kitConsistency, summarizeChecks, type ChecksSummary } from '../../domain/kits/summary'
import type { CheckMaterials, CheckResult, CheckRow, TaskKit, Testimony } from '../../domain/kits/types'
import { isImportedSnapshot, type RunSnapshot } from '../../domain/snapshot'
import type { Deps } from '../deps'

export function kitTable(deps: Pick<Deps, 'kits'>): KitTable {
  return deps.kits ?? KITS
}

/** The hearing's kit, resolved through the (possibly injected) kit table. */
export function hearingKit(deps: Pick<Deps, 'kits'>, snapshot: Pick<RunSnapshot, 'kit'>): TaskKit<unknown, unknown> {
  return kitFor(snapshot.kit?.version, kitTable(deps))
}

export interface CheckSet {
  kitVersion: string
  results: CheckResult[]
}

/**
 * Run the hearing's checks on one accepted testimony. Null for a kit without checks (general-v1),
 * so default hearings store nothing new. Logs a fault by kit version and check id only.
 */
export function checkRowFor(deps: Pick<Deps, 'kits' | 'log'>, snapshot: Pick<RunSnapshot, 'kit'>, testCase: CaseInput, testimony: Testimony, materials?: CheckMaterials): CheckSet | null {
  const kit = hearingKit(deps, snapshot)
  if (kit.checks.length === 0) return null
  const set = runChecks(kit, snapshot.kit?.settings, testCase, testimony, materials)
  for (const result of set.results) if (result.status === 'error') deps.log({ event: 'checks.error', kitVersion: set.kitVersion, checkId: result.checkId })
  return set
}

export interface TestimonyChecksInsert extends CheckSet {
  id: string
  runId: string
  caseKey: string
  configurationKey: string
  /** Exactly one of these. */
  attemptId?: string
  importedOutputId?: string
}

export function insertTestimonyChecksStatement(db: D1Database, row: TestimonyChecksInsert, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO testimony_checks (id, run_id, case_key, configuration_key, attempt_id, imported_output_id, kit_version, results_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.runId, row.caseKey, row.configurationKey, row.attemptId ?? null, row.importedOutputId ?? null, row.kitVersion, JSON.stringify(row.results), now)
}

/**
 * Check rows for imported answers at admission (D-38), one per frozen answer, referencing the
 * `run_imported_outputs` row the same batch creates. The text checked is the text whose hash the
 * snapshot commits to (read together with that hash).
 */
export function importedCheckStatements(
  deps: Pick<Deps, 'db' | 'kits' | 'log' | 'newId'>,
  snapshot: Pick<RunSnapshot, 'kit' | 'cases'>,
  runId: string,
  imported: ReadonlyArray<{ id: string; configurationKey: string; caseKey: string; text: string }>,
  now: number,
  /** Spec 05 (D-93): the question's frozen materials (a grounded question's verified sources). */
  materialsFor: (caseKey: string) => CheckMaterials | undefined = () => undefined,
): D1PreparedStatement[] {
  return imported.flatMap((item) => {
    const testCase = snapshot.cases.find((candidate) => candidate.key === item.caseKey)
    const set = testCase ? checkRowFor(deps, snapshot, testCase, { kind: 'text', text: item.text }, materialsFor(item.caseKey)) : null
    return set ? [insertTestimonyChecksStatement(deps.db, { id: deps.newId(), runId, caseKey: item.caseKey, configurationKey: item.configurationKey, importedOutputId: item.id, ...set }, now)] : []
  })
}

// ---------------------------------------------------------------------------
// Read projection (after unsealing only; the caller enforces it)
// ---------------------------------------------------------------------------

interface StoredCheckRow {
  attempt_id: string | null
  imported_output_id: string | null
  case_key: string
  configuration_key: string
  results_json: string
}

export interface KitInfo {
  version: string
  name: string
  settings: unknown
}

interface GenerationRef {
  case_key: string
  configuration_key: string
  sample_no: number
  status: string
  accepted_attempt_id: string | null
}

export interface KitResults {
  /** Null for general-v1. */
  kit: KitInfo | null
  /** Null when the hearing's kit has no checks. */
  checks: ChecksSummary | null
  /** Results for the accepted testimony of one slot; null when it has none or the kit has no checks. */
  forSlot(caseKey: string, configurationKey: string, sampleNo: number | null): CheckResult[] | null
  kitFieldsOf(caseKey: string): CaseInput['kitFields'] | null
  /** Spec 01 §10: per party, sample agreement on the kit's consistency key (repeats only). */
  consistency: Record<string, { agreement: number; key: string } | null>
}

export async function loadKitResults(
  deps: Pick<Deps, 'db' | 'kits'>,
  input: { runId: string; snapshot: RunSnapshot; eligibleCaseKeys: readonly string[]; generations: readonly GenerationRef[]; samplesPerAnswer: number },
): Promise<KitResults> {
  const { snapshot } = input
  const kit = hearingKit(deps, snapshot)
  const info: KitInfo | null = snapshot.kit ? { version: snapshot.kit.version, name: kit.name, settings: snapshot.kit.settings } : null
  const kitFieldsOf = (caseKey: string) => snapshot.cases.find((testCase) => testCase.key === caseKey)?.kitFields ?? null
  if (kit.checks.length === 0) return { kit: info, checks: null, forSlot: () => null, kitFieldsOf, consistency: {} }

  const stored = (
    await deps.db
      .prepare('SELECT attempt_id, imported_output_id, case_key, configuration_key, results_json FROM testimony_checks WHERE run_id = ?')
      .bind(input.runId)
      .all<StoredCheckRow>()
  ).results
  const imported = (await deps.db.prepare('SELECT id, case_key, configuration_key FROM run_imported_outputs WHERE run_id = ?').bind(input.runId).all<{ id: string; case_key: string; configuration_key: string }>()).results
  const byAttempt = new Map(stored.filter((row) => row.attempt_id).map((row) => [row.attempt_id!, JSON.parse(row.results_json) as CheckResult[]]))
  const byImport = new Map(stored.filter((row) => row.imported_output_id).map((row) => [row.imported_output_id!, JSON.parse(row.results_json) as CheckResult[]]))

  // Readers use the row of the accepted attempt (a retried generation's attempt 2 has its own row).
  const forSlot = (caseKey: string, configurationKey: string, sampleNo: number | null): CheckResult[] | null => {
    if (sampleNo === null) {
      const output = imported.find((row) => row.case_key === caseKey && row.configuration_key === configurationKey)
      return output ? (byImport.get(output.id) ?? null) : null
    }
    const generation = input.generations.find((g) => g.case_key === caseKey && g.configuration_key === configurationKey && g.sample_no === sampleNo)
    return generation?.status === 'succeeded' && generation.accepted_attempt_id ? (byAttempt.get(generation.accepted_attempt_id) ?? null) : null
  }

  // The scored testimony per question and party: the imported answer, or the primary sample (D-65).
  const rows: CheckRow[] = []
  const sampleRows: CheckRow[] = []
  for (const testCase of snapshot.cases) {
    for (const configuration of snapshot.configurations) {
      if (isImportedSnapshot(configuration)) {
        const results = forSlot(testCase.key, configuration.key, null)
        if (results) rows.push({ caseKey: testCase.key, configurationKey: configuration.key, results })
        continue
      }
      const slot = input.generations.filter((g) => g.case_key === testCase.key && g.configuration_key === configuration.key).sort((a, b) => a.sample_no - b.sample_no)
      const primary = slot.find((g) => g.status === 'succeeded' && g.accepted_attempt_id !== null)
      const primaryResults = primary ? forSlot(testCase.key, configuration.key, primary.sample_no) : null
      if (primaryResults) rows.push({ caseKey: testCase.key, configurationKey: configuration.key, results: primaryResults })
      for (const g of slot) {
        const results = forSlot(testCase.key, configuration.key, g.sample_no)
        if (results) sampleRows.push({ caseKey: testCase.key, configurationKey: configuration.key, results })
      }
    }
  }

  const checks = summarizeChecks({
    kit,
    settings: snapshot.kit?.settings,
    cases: snapshot.cases,
    eligibleCaseKeys: input.eligibleCaseKeys,
    configurationKeys: snapshot.configurations.map((configuration) => configuration.key),
    rows,
    ...(input.samplesPerAnswer > 1 ? { sampleRows } : {}),
  })
  const consistency = input.samplesPerAnswer > 1 ? kitConsistency(kit, sampleRows, input.eligibleCaseKeys, snapshot.configurations.map((configuration) => configuration.key)) : {}
  return { kit: info, checks, forSlot, kitFieldsOf, consistency }
}

// ---------------------------------------------------------------------------
// Attach to the results projection without restructuring it
// ---------------------------------------------------------------------------

type Checks = { checks: CheckResult[] | null }
type ResponseLike = { configurationKey: string; status: string; sampleNo?: number; samples?: ReadonlyArray<{ sampleNo: number }> }
type CaseLike = { key: string; responses: ReadonlyArray<ResponseLike> }

type WithResponseChecks<R> = R extends { samples?: ReadonlyArray<infer S> }
  ? Omit<R, 'samples'> & Partial<Checks> & { samples?: Array<S & Partial<Checks>> }
  : R & Partial<Checks>
type WithCaseChecks<C extends CaseLike> = Omit<C, 'responses'> & { kitFields?: CaseInput['kitFields'] | null; responses: Array<WithResponseChecks<C['responses'][number]>> }

/**
 * Adds `kit` and `checks` to a results projection and, only when the hearing has a kit or checks,
 * `cases[].kitFields` and `responses[].checks` (and `samples[].checks`). General hearings get
 * `kit: null, checks: null` and nothing else, so their export bytes and fingerprint are unchanged.
 */
export function withKitResults<R extends { cases: readonly CaseLike[] }>(kitResults: KitResults, base: R): Omit<R, 'cases'> & { kit: KitInfo | null; checks: ChecksSummary | null; cases: Array<WithCaseChecks<R['cases'][number]>> } {
  type C = R['cases'][number]
  const present = kitResults.kit !== null || kitResults.checks !== null
  const cases = base.cases.map((testCase) => {
    if (!present) return testCase as unknown as WithCaseChecks<C>
    return {
      ...testCase,
      kitFields: kitResults.kitFieldsOf(testCase.key),
      responses: testCase.responses.map((response) => {
        const sampleNo = response.status === 'imported' ? null : (response.sampleNo ?? 1)
        return {
          ...response,
          checks: kitResults.forSlot(testCase.key, response.configurationKey, sampleNo),
          ...(response.samples ? { samples: response.samples.map((sample) => ({ ...sample, checks: kitResults.forSlot(testCase.key, response.configurationKey, sample.sampleNo) })) } : {}),
        }
      }),
    } as unknown as WithCaseChecks<C>
  })
  return { ...base, ...withKitConsistency(base, kitResults), kit: kitResults.kit, checks: kitResults.checks, cases }
}

/** Fills `setupMetrics[party].consistency.byKit` (spec 01 §10) where the kit gives a key and the party has repeats. */
function withKitConsistency(base: object, kitResults: KitResults): object {
  const metrics = (base as { setupMetrics?: Record<string, { consistency?: object | null }> }).setupMetrics
  if (!metrics || Object.values(kitResults.consistency).every((value) => value === null)) return {}
  return {
    setupMetrics: Object.fromEntries(
      Object.entries(metrics).map(([key, party]) => {
        const byKit = kitResults.consistency[key]
        return [key, byKit && party.consistency ? { ...party, consistency: { ...party.consistency, byKit } } : party]
      }),
    ),
  }
}
