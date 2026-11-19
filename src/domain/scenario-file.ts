/**
 * Scenario files (spec 02 §6.5–6.7, D-71). Pure and browser-safe, like the CSV
 * import (D-30): the browser parses a file the judge chose, shows what will be
 * created, and the server re-validates everything on create.
 *
 * A file is data, never instructions: nothing in it becomes an ID, a hash the
 * server trusts, a URL, or a model outside the catalog.
 */

import { z } from 'zod'
import { canonicalJson, sha256Hex } from './canonical'
import { caseInputSchema, draftInputSchema, type CaseInput, type Configuration, type DraftInput } from './contracts'
import { LIMITS } from './limits'
import type { ModelRoute } from './registry'
import { RUBRIC_VERSIONS } from './rubric'
import { utf8ByteLength } from './text'

export const SCENARIO_FORMAT = 'model-court-scenario' as const
export const SCENARIO_FORMAT_VERSION = 1 as const
const RECORD_FORMAT = 'model-court-certified-record'

const exportedParty = z.strictObject({
  label: z.string(),
  modelKey: z.string(),
  provider: z.string(),
  modelId: z.string(),
  systemPrompt: z.string(),
})

/** Strict: an unknown top-level field is refused. Questions are checked by `caseInputSchema` itself (also strict). */
const scenarioFileSchema = z.strictObject({
  format: z.literal(SCENARIO_FORMAT),
  formatVersion: z.literal(SCENARIO_FORMAT_VERSION),
  exportedAt: z.string().max(40),
  scenarioHashVersion: z.string().max(40),
  scenarioHash: z.string().max(80),
  title: z.string(),
  taskDescription: z.string(),
  rubricVersion: z.enum(RUBRIC_VERSIONS),
  messageTemplateVersion: z.string().max(40),
  /** A task kit (item 3) as frozen; validated by the draft schema, which refuses it until kits exist. */
  kit: z.unknown().optional(),
  questions: z.array(z.record(z.string(), z.unknown())).min(1).max(LIMITS.maxCases),
  comparisonMode: z.enum(['model', 'configuration']).optional(),
  parties: z.array(exportedParty).max(10).optional(),
  importedPartiesLeftOut: z.number().int().min(0).max(10).optional(),
})
export type ScenarioFile = z.infer<typeof scenarioFileSchema>

/** A certified record (export.ts): only the questions, rubric and, if chosen, the parties are read. */
const recordSchema = z.object({
  format: z.literal(RECORD_FORMAT),
  formatVersion: z.literal(1),
  run: z.object({ evaluationTitle: z.string(), comparisonMode: z.enum(['model', 'configuration']).optional() }),
  versions: z.object({ rubricVersion: z.enum(RUBRIC_VERSIONS) }),
  cases: z
    .array(z.object({ title: z.unknown(), input: z.unknown(), reference: z.unknown(), expectedBehavior: z.unknown(), messages: z.unknown().optional(), language: z.unknown().optional() }))
    .min(1)
    .max(LIMITS.maxCases),
  configurations: z.array(z.object({ label: z.string(), provider: z.string().nullable(), modelId: z.string().nullable(), systemPrompt: z.string().nullable(), source: z.string().optional() })).optional(),
  certification: z.object({ contentSha256: z.string() }).optional(),
  exportedAt: z.unknown().optional(),
})

export interface ScenarioFileIssue {
  path: string
  message: string
}

export type ScenarioFileOrigin = 'scenario_file' | 'certified_record'

export type ParsedScenario =
  | {
      ok: true
      origin: ScenarioFileOrigin
      title: string
      taskDescription: string
      draft: DraftInput
      /** Parties taken from the file (system instructions shown in full before creating). */
      partiesFromFile: number
      notices: string[]
      /** Records only: whether the content still matches its certification (informational, never a reason to trust it). */
      certification: 'matches' | 'edited' | 'absent' | null
    }
  | { ok: false; issues: ScenarioFileIssue[] }

type CatalogRoute = Pick<ModelRoute, 'key' | 'provider' | 'modelId' | 'label'>

function issuesOf(error: z.ZodError, prefix = ''): ScenarioFileIssue[] {
  return error.issues.map((issue) => ({ path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'), message: issue.message }))
}

/** Questions with fresh keys; the file's own keys (if any) are never used. */
function questionsOf(raw: ReadonlyArray<Record<string, unknown>>, newId: () => string): { cases: CaseInput[]; issues: ScenarioFileIssue[] } {
  const cases: CaseInput[] = []
  const issues: ScenarioFileIssue[] = []
  raw.forEach((question, index) => {
    const { key: _ignored, ...rest } = question
    const parsed = caseInputSchema.safeParse({ ...rest, key: newId() })
    if (parsed.success) cases.push(parsed.data)
    else issues.push(...issuesOf(parsed.error, `questions.${index}`))
  })
  return { cases, issues }
}

/**
 * Parse a scenario file or a certified record into a new case's draft.
 * `routes` is the catalog (parties map to it, never outside it); `defaults`
 * fill in when fewer than two parties survive; `maxParties` is the deployment cap.
 */
export async function parseScenarioFile(
  text: string,
  newId: () => string,
  options: { routes: readonly CatalogRoute[]; defaults: readonly Configuration[]; maxParties: number; includeParties: boolean },
): Promise<ParsedScenario> {
  if (utf8ByteLength(text) > LIMITS.scenarioFileBytes) return { ok: false, issues: [{ path: '', message: `The file is larger than ${LIMITS.scenarioFileBytes / 1024} KiB.` }] }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, issues: [{ path: '', message: 'This is not a JSON file.' }] }
  }
  const format = (json as { format?: unknown } | null)?.format
  const notices: string[] = []
  const parties: Array<{ label: string; provider: string; modelId: string; modelKey?: string; systemPrompt: string }> = []
  let base: { origin: ScenarioFileOrigin; title: string; taskDescription: string; rubricVersion: DraftInput['rubricVersion']; rawQuestions: Array<Record<string, unknown>>; kit?: unknown; comparisonMode?: 'model' | 'configuration'; certification: 'matches' | 'edited' | 'absent' | null }

  if (format === SCENARIO_FORMAT) {
    const parsed = scenarioFileSchema.safeParse(json)
    if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) }
    const file = parsed.data
    base = { origin: 'scenario_file', title: file.title, taskDescription: file.taskDescription, rubricVersion: file.rubricVersion, rawQuestions: file.questions, kit: file.kit, comparisonMode: file.comparisonMode, certification: null }
    if (file.importedPartiesLeftOut) notices.push(`${file.importedPartiesLeftOut} imported ${file.importedPartiesLeftOut === 1 ? 'party was' : 'parties were'} left out of this file by whoever exported it.`)
    if (options.includeParties) parties.push(...(file.parties ?? []))
  } else if (format === RECORD_FORMAT) {
    const parsed = recordSchema.safeParse(json)
    if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) }
    const record = parsed.data
    // Recompute the certification over every field but `exportedAt` and `certification` (export.ts).
    let certification: 'matches' | 'edited' | 'absent' = 'absent'
    if (record.certification) {
      const { exportedAt: _at, certification: _cert, ...body } = json as Record<string, unknown>
      try {
        certification = (await sha256Hex(canonicalJson(body))) === record.certification.contentSha256 ? 'matches' : 'edited'
      } catch {
        certification = 'edited'
      }
    }
    base = {
      origin: 'certified_record',
      title: record.run.evaluationTitle,
      taskDescription: '',
      rubricVersion: record.versions.rubricVersion,
      rawQuestions: record.cases.map((c) => Object.fromEntries(Object.entries({ title: c.title, input: c.input, reference: c.reference, expectedBehavior: c.expectedBehavior, messages: c.messages, language: c.language }).filter(([, value]) => value !== undefined))),
      comparisonMode: record.run.comparisonMode,
      certification,
    }
    notices.push('Only the questions are taken from this record; testimony, worksheets and judgments are left out.')
    if (options.includeParties) {
      for (const party of record.configurations ?? []) {
        if (party.source === 'imported' || !party.provider || !party.modelId || party.systemPrompt === null) notices.push(`${party.label} skipped: imported answers are not copied from a record.`)
        else parties.push({ label: party.label, provider: party.provider, modelId: party.modelId, systemPrompt: party.systemPrompt })
      }
    }
  } else {
    return { ok: false, issues: [{ path: 'format', message: 'This is neither a Model Court scenario file nor a certified record.' }] }
  }

  const { cases, issues } = questionsOf(base.rawQuestions, newId)
  if (issues.length) return { ok: false, issues }

  // Parties map to the catalog only: by route key, else by provider and model id.
  const configurations: Configuration[] = []
  for (const party of parties) {
    const route = (party.modelKey && options.routes.find((r) => r.key === party.modelKey && r.provider === party.provider)) || options.routes.find((r) => r.provider === party.provider && r.modelId === party.modelId)
    if (!route) {
      notices.push(`${party.label} skipped: model ${party.modelId} is not in this catalog.`)
      continue
    }
    if (configurations.length >= options.maxParties) {
      notices.push(`${party.label} skipped: this deployment allows at most ${options.maxParties} parties.`)
      continue
    }
    // Spec 07 §9.1: every juror scores parties × questions answers, at most 15.
    if ((configurations.length + 1) * cases.length > LIMITS.maxTestimoniesPerHearing) {
      notices.push(`${party.label} skipped: ${configurations.length + 1} parties on ${cases.length} questions would be more than ${LIMITS.maxTestimoniesPerHearing} answers for each juror.`)
      continue
    }
    configurations.push({ kind: 'model', key: newId(), label: party.label, modelKey: route.key, systemPrompt: party.systemPrompt, maxOutputTokens: LIMITS.maxOutputTokens })
  }
  let comparisonMode = base.comparisonMode ?? 'configuration'
  const partiesFromFile = configurations.length >= LIMITS.minConfigurationsPerRun ? configurations.length : 0
  if (partiesFromFile === 0) {
    if (options.includeParties && parties.length > 0) notices.push('Fewer than two parties could be used, so the default pair fills in.')
    configurations.splice(0, configurations.length, ...options.defaults.map((party) => ({ ...party, key: newId() })))
    comparisonMode = 'model'
  }
  // Model comparison needs identical instructions and different models; otherwise compare configurations.
  if (comparisonMode === 'model') {
    const models = configurations.filter((c): c is Extract<Configuration, { modelKey: string }> => 'modelKey' in c)
    if (new Set(models.map((c) => c.systemPrompt)).size > 1 || new Set(models.map((c) => c.modelKey)).size < models.length) comparisonMode = 'configuration'
  }

  const draft = draftInputSchema.safeParse({ comparisonMode, rubricVersion: base.rubricVersion, cases, configurations, ...(base.kit !== undefined ? { kit: base.kit } : {}) })
  if (!draft.success) return { ok: false, issues: issuesOf(draft.error) }
  const title = base.title.trim().slice(0, LIMITS.evaluationTitle.max) || 'Imported case'
  return { ok: true, origin: base.origin, title, taskDescription: base.taskDescription.slice(0, LIMITS.taskDescription.max), draft: draft.data, partiesFromFile, notices, certification: base.certification }
}
