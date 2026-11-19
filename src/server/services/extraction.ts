/**
 * Extraction-hearing projections (spec 04 §3.2, §3.4, §8.1, D-87): what jurors see of an
 * answer before unsealing, juror field flags, and the record's Extraction section after.
 *
 * Before unsealing a juror gets, per answer, the server's canonical rendering of the parsed
 * value in the field list's order (never the provider's bytes), or the same neutral line for
 * every party when it isn't JSON. Never a check result, the answer key, comparison rules or a
 * schema hash. The record's section is computed after unsealing with the same pure functions the
 * checks use, from the frozen answer key and the stored output.
 */

import type { DraftRating, FieldFlag } from '../../domain/contracts'
import { compareToAnswerKey, type FieldOutcome } from '../../domain/extraction/compare'
import { canonicalExtractionJson, flaggablePaths, parseOutput, renderFields, type RenderedField } from '../../domain/extraction/render'
import { leafFields, schemaSha256, type ExtractionSchema, type FieldPath } from '../../domain/extraction/schema'
import { compileWireSchema } from '../../domain/extraction/schema'
import type { ExtractionFields, ExtractionSettings } from '../../domain/kits/extraction'
import type { RunSnapshot } from '../../domain/snapshot'

export const UNPARSED_LINE = "This answer isn't valid JSON, so it can't be shown as fields."

export type ExtractionView = { status: 'parsed'; fields: RenderedField[] } | { status: 'unparsed' }

export function isExtractionHearing(snapshot: Pick<RunSnapshot, 'kit'>): boolean {
  return snapshot.kit?.version === 'extraction-v1'
}

export function extractionSettingsOf(snapshot: Pick<RunSnapshot, 'kit'>): ExtractionSettings | null {
  return isExtractionHearing(snapshot) ? (snapshot.kit!.settings as ExtractionSettings) : null
}

/** One answer as a juror sees it: canonical JSON text and field rows, or the raw text with the neutral status. */
export function jurorAnswer(schema: ExtractionSchema, text: string): { text: string; extraction: ExtractionView } {
  const parsed = parseOutput(text)
  if (parsed.status !== 'parsed') return { text, extraction: { status: 'unparsed' } }
  return { text: canonicalExtractionJson(schema, parsed.value), extraction: { status: 'parsed', fields: renderFields(schema, parsed.value) } }
}

/**
 * Juror flags (spec 04 §4.4): only on an extraction hearing, and each path must name a value row
 * of that very answer as the juror sees it.
 */
export function fieldFlagIssues(snapshot: Pick<RunSnapshot, 'kit'>, textOf: (responseId: string) => string | undefined, ratings: readonly DraftRating[]): Array<{ path: string; message: string }> {
  const settings = extractionSettingsOf(snapshot)
  const issues: Array<{ path: string; message: string }> = []
  ratings.forEach((rating, index) => {
    if (!rating.fieldFlags || rating.fieldFlags.length === 0) return
    if (!settings) {
      issues.push({ path: `ratings.${index}.fieldFlags`, message: 'Field flags are only for field-extraction hearings.' })
      return
    }
    const parsed = parseOutput(textOf(rating.responseId) ?? '')
    const allowed = parsed.status === 'parsed' ? flaggablePaths(settings.schema, parsed.value) : new Set<string>()
    rating.fieldFlags.forEach((flag, flagIndex) => {
      if (!allowed.has(flag.path)) issues.push({ path: `ratings.${index}.fieldFlags.${flagIndex}.path`, message: 'This answer has no such field.' })
    })
  })
  return issues
}

// ---------------------------------------------------------------------------
// The record's Extraction section (after unsealing only; the caller enforces it)
// ---------------------------------------------------------------------------

export interface ExtractionPartyRow {
  configurationKey: string
  answers: number
  validJson: number
  requiredFilled: number
  compared: number
  matched: number
  invented: number
  missed: number
  flaggedInvented: number
  flaggedAmbiguous: number
}

export interface ExtractionFieldRow {
  path: FieldPath
  /** null = the key says the document doesn't have it; undefined is never sent (left-out fields aren't rows). */
  answerKey: unknown
  byParty: Record<string, { value: unknown; outcome: FieldOutcome | null; flags: { invented: number; ambiguous: number } }>
}

export interface ExtractionSection {
  schemaSha256: string
  authoringSchema: ExtractionSchema
  wireSchema: Record<string, unknown>
  compare: ExtractionSettings['compare']
  fieldOrder: string[]
  parties: ExtractionPartyRow[]
  cases: Array<{ caseKey: string; answerKey: unknown; fields: ExtractionFieldRow[] }>
}

interface AnswerInput {
  caseKey: string
  configurationKey: string
  text: string | null
  /** The `required-filled` check result, when stored. */
  requiredFilled: boolean | null
  flags: readonly FieldFlag[]
}

function pointer(value: unknown, path: FieldPath): unknown {
  let current = value
  for (const segment of path.split('/').slice(1)) {
    if (Array.isArray(current)) current = current[Number(segment)]
    else if (current && typeof current === 'object' && Object.hasOwn(current, segment)) current = (current as Record<string, unknown>)[segment]
    else return undefined
  }
  return current
}

/** The scored answer per question and party, with its juror flags, summarized per party and per field. */
export async function extractionSection(snapshot: RunSnapshot, answers: readonly AnswerInput[]): Promise<ExtractionSection | null> {
  const settings = extractionSettingsOf(snapshot)
  if (!settings) return null
  const keys = snapshot.configurations.map((configuration) => configuration.key)
  const parties = new Map<string, ExtractionPartyRow>(keys.map((key) => [key, { configurationKey: key, answers: 0, validJson: 0, requiredFilled: 0, compared: 0, matched: 0, invented: 0, missed: 0, flaggedInvented: 0, flaggedAmbiguous: 0 }]))
  const cases: ExtractionSection['cases'] = []
  for (const testCase of snapshot.cases) {
    const answerKey = (testCase.kitFields as ExtractionFields | undefined)?.answerKey
    const rows = new Map<string, ExtractionFieldRow>()
    const rowFor = (path: string, expected: unknown) => {
      let row = rows.get(path)
      if (!row) {
        row = { path, answerKey: expected, byParty: {} }
        rows.set(path, row)
      }
      return row
    }
    for (const answer of answers.filter((item) => item.caseKey === testCase.key)) {
      const party = parties.get(answer.configurationKey)
      if (!party) continue
      party.answers += 1
      const parsed = answer.text === null ? ({ status: 'unparsed' } as const) : parseOutput(answer.text)
      if (parsed.status === 'parsed') party.validJson += 1
      if (answer.requiredFilled) party.requiredFilled += 1
      for (const flag of answer.flags) {
        if (flag.flag === 'invented') party.flaggedInvented += 1
        else party.flaggedAmbiguous += 1
      }
      const flagsAt = (path: string) => ({ invented: answer.flags.filter((flag) => flag.path === path && flag.flag === 'invented').length, ambiguous: answer.flags.filter((flag) => flag.path === path && flag.flag === 'ambiguous').length })
      if (answerKey && parsed.status === 'parsed') {
        const result = compareToAnswerKey(settings.schema, settings.compare, answerKey, parsed.value)
        party.compared += result.counts.compared
        party.matched += result.counts.match
        party.invented += result.counts.invented
        party.missed += result.counts.missed
        for (const field of result.fields) {
          rowFor(field.path, field.outcome === 'extra_item' ? null : (field.expected ?? null)).byParty[answer.configurationKey] = { value: field.actual ?? null, outcome: field.outcome, flags: flagsAt(field.path) }
        }
      }
      // Flagged fields the comparison didn't cover still get a row, so a flag is never lost.
      for (const flag of answer.flags) {
        const row = rowFor(flag.path, answerKey ? (pointer(answerKey, flag.path) ?? null) : null)
        if (!row.byParty[answer.configurationKey]) row.byParty[answer.configurationKey] = { value: parsed.status === 'parsed' ? (pointer(parsed.value, flag.path) ?? null) : null, outcome: null, flags: flagsAt(flag.path) }
      }
    }
    cases.push({ caseKey: testCase.key, answerKey: answerKey ?? null, fields: [...rows.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) })
  }
  return {
    schemaSha256: await schemaSha256(settings.schema),
    authoringSchema: settings.schema,
    wireSchema: compileWireSchema(settings.schema),
    compare: settings.compare,
    fieldOrder: leafFields(settings.schema).map((leaf) => leaf.pattern),
    parties: [...parties.values()],
    cases,
  }
}
