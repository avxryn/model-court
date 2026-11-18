/**
 * Scenario fingerprints (spec 02 §4, D-67). Pure and browser-safe.
 *
 * A scenario is what a hearing asks and how it is judged: the questions
 * (matched by content, never by key), the rubric version, the message
 * template and, once task kits exist (item 3), the kit version and settings.
 * Hearings of one case are grouped by it. Nothing here is stored: hashes are
 * recomputed from immutable snapshots with this versioned function.
 */

import { canonicalJson, sha256Hex } from './canonical'
import type { CaseInput, Draft } from './contracts'
import { templateFor, type MessageTemplateVersion } from './messages'
import { RUBRIC_VERSION, type RubricVersion } from './rubric'
import { isImportedSnapshot, type RunSnapshot, type SnapshotConfiguration } from './snapshot'

export const SCENARIO_HASH_VERSION = 'scenario-v1' as const

/**
 * Question fields that are labels or grouping only and never change what a
 * party is sent or how a juror scores (Q7): fixing a title typo or a language
 * tag keeps a question the same question.
 */
const EXCLUDED_QUESTION_FIELDS: ReadonlySet<string> = new Set(['key', 'title', 'language'])

/**
 * What a model is sent or a juror judges by: every field of the frozen
 * question except key, title and language. Generic on purpose, so fields a
 * task kit adds to `CaseInput` (item 3) are covered without a change here.
 * An absent conversation and an empty one are the same.
 */
export function questionContent(testCase: CaseInput): Record<string, unknown> {
  const content: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(testCase)) {
    if (!EXCLUDED_QUESTION_FIELDS.has(field) && value !== undefined) content[field] = value
  }
  content.messages = testCase.messages ?? []
  return content
}

export async function questionHash(testCase: CaseInput): Promise<string> {
  return sha256Hex(canonicalJson(questionContent(testCase)))
}

export interface ScenarioSource {
  cases: CaseInput[]
  rubricVersion: RubricVersion
  messageTemplateVersion: MessageTemplateVersion | string
  /** Task kit (item 3), present only when the snapshot or draft has one; absent keeps existing hashes. */
  kitVersion?: string
  kitSettings?: unknown
}

/** Order-independent: the sorted question hashes plus the versions that change how answers are asked for and judged. */
export async function scenarioHash(source: ScenarioSource): Promise<string> {
  const questions = (await Promise.all(source.cases.map(questionHash))).sort()
  return sha256Hex(
    canonicalJson({
      v: SCENARIO_HASH_VERSION,
      rubricVersion: source.rubricVersion,
      messageTemplateVersion: source.messageTemplateVersion,
      ...(source.kitVersion !== undefined ? { kitVersion: source.kitVersion } : {}),
      ...(source.kitSettings !== undefined ? { kitSettings: source.kitSettings } : {}),
      questions,
    }),
  )
}

/** A kit as item 3 freezes it (`kit: {version, settings}`), read without depending on its types. */
function kitOf(value: unknown): Pick<ScenarioSource, 'kitVersion' | 'kitSettings'> {
  const record = value as { kit?: { version?: unknown; settings?: unknown }; kitVersion?: unknown }
  const version = typeof record.kit?.version === 'string' ? record.kit.version : typeof record.kitVersion === 'string' ? record.kitVersion : undefined
  if (version === undefined) return {}
  return { kitVersion: version, ...(record.kit?.settings !== undefined ? { kitSettings: record.kit.settings } : {}) }
}

export function scenarioSourceOfSnapshot(snapshot: RunSnapshot): ScenarioSource {
  return { cases: snapshot.cases, rubricVersion: snapshot.rubricVersion, messageTemplateVersion: snapshot.messageTemplateVersion, ...kitOf(snapshot) }
}

/** Must agree with `buildSnapshot` (tested), so the start-time check and read-time grouping use the same hash. */
export function scenarioSourceOfDraft(draft: Pick<Draft, 'cases' | 'rubricVersion'>): ScenarioSource {
  return { cases: draft.cases, rubricVersion: draft.rubricVersion ?? RUBRIC_VERSION, messageTemplateVersion: templateFor(draft.cases), ...kitOf(draft) }
}

/** question key → question hash, for one hearing or draft. */
export async function questionHashes(cases: readonly CaseInput[]): Promise<Map<string, string>> {
  return new Map(await Promise.all(cases.map(async (testCase) => [testCase.key, await questionHash(testCase)] as const)))
}

/**
 * A setup's identity, independent of its key, label and adapter version (an
 * app upgrade must not dissolve every anchor). `modelId` is what was sent.
 * Imported parties are identified by their provenance and exact answers,
 * keyed by question content.
 */
export async function partyFingerprint(configuration: SnapshotConfiguration, questionHashByCaseKey: ReadonlyMap<string, string>): Promise<string> {
  if (isImportedSnapshot(configuration)) {
    const answers = configuration.imports.map((item) => [questionHashByCaseKey.get(item.caseKey) ?? `missing:${item.caseKey}`, item.sha256] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    return sha256Hex(canonicalJson({ source: 'imported', provenance: configuration.provenance, answers }))
  }
  return sha256Hex(
    canonicalJson({ source: 'model', provider: configuration.provider, modelId: configuration.modelId, systemPrompt: configuration.systemPrompt, maxOutputTokens: configuration.maxOutputTokens }),
  )
}

// ---------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------

export interface QuestionRef {
  key: string
  title: string
}

export interface ScenarioDiff {
  added: QuestionRef[]
  removed: QuestionRef[]
  /** A question whose content changed: paired by key first, then by title. */
  edited: Array<{ fromKey: string; toKey: string; title: string }>
  rubricChanged: boolean
  templateChanged: boolean
  kitChanged: boolean
}

export async function diffScenarios(a: ScenarioSource, b: ScenarioSource): Promise<ScenarioDiff> {
  const hashesA = await Promise.all(a.cases.map(questionHash))
  const hashesB = await Promise.all(b.cases.map(questionHash))
  // Match identical content first, one to one (two identical questions are two matches).
  const unmatchedA = new Set(a.cases.map((_, index) => index))
  const unmatchedB = new Set(b.cases.map((_, index) => index))
  for (const i of [...unmatchedA]) {
    const j = [...unmatchedB].find((index) => hashesB[index] === hashesA[i])
    if (j !== undefined) {
      unmatchedA.delete(i)
      unmatchedB.delete(j)
    }
  }
  const edited: ScenarioDiff['edited'] = []
  for (const same of [(x: CaseInput, y: CaseInput) => x.key === y.key, (x: CaseInput, y: CaseInput) => x.title === y.title]) {
    for (const i of [...unmatchedA]) {
      const j = [...unmatchedB].find((index) => same(a.cases[i], b.cases[index]))
      if (j === undefined) continue
      unmatchedA.delete(i)
      unmatchedB.delete(j)
      edited.push({ fromKey: a.cases[i].key, toKey: b.cases[j].key, title: b.cases[j].title })
    }
  }
  const ref = (testCase: CaseInput): QuestionRef => ({ key: testCase.key, title: testCase.title })
  return {
    added: [...unmatchedB].sort((x, y) => x - y).map((index) => ref(b.cases[index])),
    removed: [...unmatchedA].sort((x, y) => x - y).map((index) => ref(a.cases[index])),
    edited,
    rubricChanged: a.rubricVersion !== b.rubricVersion,
    templateChanged: a.messageTemplateVersion !== b.messageTemplateVersion,
    kitChanged: a.kitVersion !== b.kitVersion || canonicalJson(a.kitSettings ?? null) !== canonicalJson(b.kitSettings ?? null),
  }
}

export function diffIsEmpty(diff: ScenarioDiff): boolean {
  return diff.added.length + diff.removed.length + diff.edited.length === 0 && !diff.rubricChanged && !diff.templateChanged && !diff.kitChanged
}

export type PartyChange =
  | { kind: 'added'; label: string }
  | { kind: 'removed'; label: string }
  | { kind: 'model'; label: string; from: { provider: string; modelId: string }; to: { provider: string; modelId: string } }
  | { kind: 'prompt'; label: string }
  | { kind: 'source'; label: string; to: 'imported' | 'model' }
  | { kind: 'provenance'; label: string }
  | { kind: 'answers'; label: string }

/**
 * Party changes from hearing `a` to hearing `b`. Parties pair by label (what
 * the judge reads: "Party B"), then by key (a restored draft keeps keys).
 */
export function diffParties(a: readonly SnapshotConfiguration[], b: readonly SnapshotConfiguration[]): PartyChange[] {
  const unmatchedA = new Set(a.map((_, index) => index))
  const pairs: Array<[SnapshotConfiguration, SnapshotConfiguration]> = []
  const added: SnapshotConfiguration[] = []
  const rest: SnapshotConfiguration[] = []
  for (const party of b) {
    const i = [...unmatchedA].find((index) => a[index].label === party.label)
    if (i === undefined) {
      rest.push(party)
      continue
    }
    unmatchedA.delete(i)
    pairs.push([a[i], party])
  }
  for (const party of rest) {
    const i = [...unmatchedA].find((index) => a[index].key === party.key)
    if (i === undefined) {
      added.push(party)
      continue
    }
    unmatchedA.delete(i)
    pairs.push([a[i], party])
  }
  const changes: PartyChange[] = []
  for (const [from, to] of pairs) {
    const label = to.label
    const fromImported = isImportedSnapshot(from)
    const toImported = isImportedSnapshot(to)
    if (fromImported !== toImported) {
      changes.push({ kind: 'source', label, to: toImported ? 'imported' : 'model' })
      continue
    }
    if (isImportedSnapshot(from) && isImportedSnapshot(to)) {
      if (canonicalJson(from.provenance) !== canonicalJson(to.provenance)) changes.push({ kind: 'provenance', label })
      const answers = (party: typeof from) => party.imports.map((item) => item.sha256).sort().join(',')
      if (answers(from) !== answers(to)) changes.push({ kind: 'answers', label })
      continue
    }
    if (!isImportedSnapshot(from) && !isImportedSnapshot(to)) {
      if (from.provider !== to.provider || from.modelId !== to.modelId) changes.push({ kind: 'model', label, from: { provider: from.provider, modelId: from.modelId }, to: { provider: to.provider, modelId: to.modelId } })
      if (from.systemPrompt !== to.systemPrompt) changes.push({ kind: 'prompt', label })
    }
  }
  for (const party of added) changes.push({ kind: 'added', label: party.label })
  for (const index of [...unmatchedA].sort((x, y) => x - y)) changes.push({ kind: 'removed', label: a[index].label })
  return changes
}
