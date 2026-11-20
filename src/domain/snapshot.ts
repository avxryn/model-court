/**
 * Immutable run snapshot (spec §5.3) and the readiness rules that decide
 * whether a draft can start a run. Shared by the editor and run admission.
 */

import { CANONICALIZATION_VERSION } from './canonical'
import { isImported, type CaseInput, type ComparisonMode, type Configuration, type Draft, type ImportedConfiguration, type ModelConfiguration } from './contracts'
import { kitFor, kitReadinessIssues } from './kits/registry'
import type { KitReadinessIssue } from './kits/types'
import type { MessageTemplateVersion } from './messages'
import { adapterVersionFor, findRoute, isRouteEnabled, PROVIDER_NAMES, PROVIDER_REGISTRY_VERSION, type ModelRoute, type ProviderId } from './registry'
import type { RubricVersion } from './rubric'

/** A generated party, frozen with its resolved route. Older snapshots have no `source` field. */
export type GeneratedSnapshotConfiguration = ModelConfiguration & {
  provider: ProviderId
  modelId: string
  adapterVersion: string
}

/** One imported answer's fingerprint; the text itself lives in `run_imported_outputs` (D-38). */
export interface ImportMeta {
  configurationKey: string
  caseKey: string
  sha256: string
  byteLength: number
}

/** An imported party, frozen with the hash of every answer so the snapshot hash commits to the exact bytes. */
export type ImportedSnapshotConfiguration = ImportedConfiguration & {
  source: 'imported'
  imports: Array<{ caseKey: string; sha256: string; byteLength: number }>
}

export type SnapshotConfiguration = GeneratedSnapshotConfiguration | ImportedSnapshotConfiguration

export function isImportedSnapshot(configuration: SnapshotConfiguration): configuration is ImportedSnapshotConfiguration {
  return isImported(configuration)
}

export function generatedParties<T extends { kind?: string }>(configurations: readonly T[]): Array<Exclude<T, { kind: 'imported' }>> {
  return configurations.filter((configuration) => !isImported(configuration)) as Array<Exclude<T, { kind: 'imported' }>>
}

export interface RunSnapshot {
  schemaVersion: 1
  canonicalizationVersion: typeof CANONICALIZATION_VERSION
  comparisonMode: ComparisonMode
  cases: CaseInput[]
  configurations: SnapshotConfiguration[]
  rubricVersion: RubricVersion
  messageTemplateVersion: MessageTemplateVersion
  providerRegistryVersion: string
  appCommit: string
  createdAt: number
  /** D-65: present only when the judge asked for repeats (2 or 3); absent means once. Part of the hashed plan. */
  samplesPerAnswer?: 2 | 3
  /** Spec 03 (D-75): the task kit and its frozen settings. Absent for general-v1, so pre-kit snapshots and their hashes are unchanged. */
  kit?: { version: string; settings: unknown }
}

/** How many times each generated party answers each question. */
export function samplesPerAnswer(snapshot: Pick<RunSnapshot, 'samplesPerAnswer'>): number {
  return snapshot.samplesPerAnswer ?? 1
}

export type ReadinessIssue =
  | { kind: 'unknown_model'; configurationKey: string }
  | { kind: 'model_unavailable'; configurationKey: string; modelKey: string }
  | { kind: 'model_mode_instructions_differ' }
  | { kind: 'model_mode_same_model' }
  | { kind: 'imported_requires_configuration_mode' }
  | { kind: 'imported_text_missing'; configurationKey: string; caseKey: string }
  | { kind: 'history_unverified'; configurationKey: string }
  /** Spec 04 §6.5 (D-86): an extraction hearing on a route without a recorded structured-output check. */
  | { kind: 'structured_unverified'; configurationKey: string; modelKey: string }
  /** Spec 04 §6.5: a native-PDF question on a route without a recorded PDF check. */
  | { kind: 'pdf_unverified'; configurationKey: string; modelKey: string }
  /** Spec 04 §4.6: the question's document is gone from the store (a PDF a restore left out) or changed under the draft. */
  | { kind: 'document_not_restored'; caseKey: string }
  /** Spec 06 §5.1 (D-99): a tool-use hearing on a route without a recorded live tool check. */
  | { kind: 'tools_unverified'; configurationKey: string; modelKey: string }
  /** Spec 06 (D-99): imported answers have no tool calls, so a tool-use hearing takes generated parties only. */
  | { kind: 'tools_imported_unsupported'; configurationKey: string }
  /**
   * Spec 07 (D-108): the route's adapter versions cannot carry what the kit needs at all (Gemini routes
   * send no structured output, PDF or tools), whatever live checks are recorded.
   */
  | { kind: 'feature_unsupported'; configurationKey: string; modelKey: string; feature: 'json' | 'tools' }
  | KitReadinessIssue

/** A kit whose parties answer in JSON (extraction) sends a structured-output schema. */
export function needsStructuredOutput(draft: { kit?: { version: string } | undefined }): boolean {
  return kitFor(draft.kit?.version).outputContract.kind === 'json'
}

/** Spec 06 (D-99): a kit whose testimony is a tool trace runs a tool loop per answer. */
export function usesTools(draft: { kit?: { version: string } | undefined }): boolean {
  return kitFor(draft.kit?.version).outputContract.kind === 'toolTrace'
}

/** Spec 04 (D-89): a question whose document goes to the providers as the PDF file itself. */
export function sendsPdfFile(cases: ReadonlyArray<Pick<CaseInput, 'kitFields'>>): boolean {
  return cases.some((testCase) => (testCase.kitFields as { kind?: string; document?: { delivery?: string } } | undefined)?.document?.delivery === 'pdf_native')
}

/** The features a structured hearing's adapter version must carry (its successor has both, spec 04 §6.4). */
const FEATURES = { structuredOutput: true, pdfInput: true } as const

export function readinessIssues(draft: Pick<Draft, 'comparisonMode' | 'configurations'> & Partial<Pick<Draft, 'cases' | 'kit'>>, routes: readonly ModelRoute[]): ReadinessIssue[] {
  const issues: ReadinessIssue[] = []
  const models = generatedParties(draft.configurations)
  const hasHistory = (draft.cases ?? []).some((testCase) => (testCase.messages?.length ?? 0) > 0)
  const structured = needsStructuredOutput(draft)
  const sendsPdf = sendsPdfFile(draft.cases ?? [])
  const tools = usesTools(draft)
  if (tools) for (const configuration of draft.configurations) if (isImported(configuration)) issues.push({ kind: 'tools_imported_unsupported', configurationKey: configuration.key })
  for (const configuration of models) {
    const route = findRoute(configuration.modelKey, routes)
    if (!route) issues.push({ kind: 'unknown_model', configurationKey: configuration.key })
    else if (structured && !adapterVersionFor(route.adapterVersion, FEATURES)) issues.push({ kind: 'feature_unsupported', configurationKey: configuration.key, modelKey: route.key, feature: 'json' })
    else if (tools && !adapterVersionFor(route.adapterVersion, { toolUse: true })) issues.push({ kind: 'feature_unsupported', configurationKey: configuration.key, modelKey: route.key, feature: 'tools' })
    else if (!isRouteEnabled(route)) issues.push({ kind: 'model_unavailable', configurationKey: configuration.key, modelKey: route.key })
    else if (hasHistory && !route.multiTurnVerifiedAt) issues.push({ kind: 'history_unverified', configurationKey: configuration.key })
    else if (structured && (!route.structuredVerifiedAt || !adapterVersionFor(route.adapterVersion, FEATURES))) issues.push({ kind: 'structured_unverified', configurationKey: configuration.key, modelKey: route.key })
    else if (structured && sendsPdf && !route.pdfVerifiedAt) issues.push({ kind: 'pdf_unverified', configurationKey: configuration.key, modelKey: route.key })
    else if (tools && (!route.toolsVerifiedAt || !adapterVersionFor(route.adapterVersion, { toolUse: true }))) issues.push({ kind: 'tools_unverified', configurationKey: configuration.key, modelKey: route.key })
  }
  if (draft.comparisonMode === 'model') {
    if (models.length < draft.configurations.length) issues.push({ kind: 'imported_requires_configuration_mode' })
    const prompts = new Set(models.map((configuration) => configuration.systemPrompt))
    if (prompts.size > 1) issues.push({ kind: 'model_mode_instructions_differ' })
    const modelKeys = new Set(models.map((configuration) => configuration.modelKey))
    if (modelKeys.size < models.length) issues.push({ kind: 'model_mode_same_model' })
  }
  issues.push(...kitReadinessIssues(draft))
  return issues
}

/** Every imported party needs an answer for every question before a hearing can start. */
export function importCoverageIssues(draft: Pick<Draft, 'cases' | 'configurations'>, imports: ReadonlyArray<Pick<ImportMeta, 'configurationKey' | 'caseKey'>>): ReadinessIssue[] {
  const present = new Set(imports.map((item) => `${item.configurationKey}:${item.caseKey}`))
  return draft.configurations.filter(isImported).flatMap((configuration) =>
    draft.cases.filter((testCase) => !present.has(`${configuration.key}:${testCase.key}`)).map((testCase) => ({ kind: 'imported_text_missing' as const, configurationKey: configuration.key, caseKey: testCase.key })),
  )
}

/** "Q2" for a question's position, or "a question" when the list is not at hand. */
function questionName(caseKey: string, cases?: ReadonlyArray<Pick<CaseInput, 'key'>>): string {
  const index = cases?.findIndex((testCase) => testCase.key === caseKey) ?? -1
  return index >= 0 ? `Q${index + 1}` : 'a question'
}

export function describeIssue(issue: ReadinessIssue, cases?: ReadonlyArray<Pick<CaseInput, 'key'>>): string {
  switch (issue.kind) {
    case 'unknown_model':
      return 'A configuration uses a model that is not in the catalog.'
    case 'model_unavailable': {
      const route = findRoute(issue.modelKey)
      return `${route ? `${PROVIDER_NAMES[route.provider]} ${route.label}` : 'A selected model'} has not passed its live check yet (one real call, recorded), so a hearing cannot use it. Choose a checked model or record that call first.`
    }
    case 'model_mode_instructions_differ':
      return 'Model comparison requires identical system instructions. Switch to configuration comparison to vary them.'
    case 'model_mode_same_model':
      return 'Model comparison needs a different model for each configuration.'
    case 'imported_requires_configuration_mode':
      return 'An imported party needs configuration comparison. Switch the comparison mode.'
    case 'imported_text_missing':
      return 'An imported party is missing an answer for at least one question. Add every answer and save it.'
    case 'history_unverified':
      return 'A question has a conversation, but a selected model has not yet passed a live multi-message check. Remove the conversation or wait for that check.'
    case 'document_not_restored':
      return `The source file of ${questionName(issue.caseKey, cases)} was not restored, so no call can be sent with it. Upload the same file again on that question.`
    case 'pdf_unverified': {
      const route = findRoute(issue.modelKey)
      return `A question sends a PDF file, and ${route ? `${PROVIDER_NAMES[route.provider]} ${route.label}` : 'a selected model'} hasn't passed a live PDF check yet (one real call, recorded). Send the text only, choose a checked model, or record that check first.`
    }
    case 'structured_unverified': {
      const route = findRoute(issue.modelKey)
      return `Pulling fields from documents needs a model that has passed a live structured-output check (one real call, recorded). ${route ? `${PROVIDER_NAMES[route.provider]} ${route.label}` : 'A selected model'} hasn't yet. Choose a checked model or record that check first.`
    }
    case 'kit_input_unsupported': {
      const name = kitFor(issue.kitVersion).name
      const what = issue.inputKind === 'conversation' ? 'a conversation' : `${issue.inputKind} input`
      return `${name} questions can't carry ${what} yet. Remove it from ${questionName(issue.caseKey, cases)} or switch the task kit to General answers.`
    }
    case 'kit_document_missing':
      // Spec 04: an extraction question's document is uploaded beside the question, not typed in the exhibit.
      return kitFor(issue.kitVersion).inputKinds.includes('document')
        ? `Every question needs a document to pull fields from. Add one to ${questionName(issue.caseKey, cases)}.`
        : `${kitFor(issue.kitVersion).name} needs a document in the exhibit of every question. Add one to ${questionName(issue.caseKey, cases)}.`
    case 'tools_unverified': {
      const route = findRoute(issue.modelKey)
      return `A question uses tools, but ${route ? `${PROVIDER_NAMES[route.provider]} ${route.label}` : 'a selected model'} hasn't passed a live tool check yet (one real tool call and its result, recorded). Choose a checked model or record that check first.`
    }
    case 'feature_unsupported': {
      const route = findRoute(issue.modelKey)
      const name = route ? `${PROVIDER_NAMES[route.provider]} ${route.label}` : 'A selected model'
      // D-118: only Gemini lacks these features as a provider; otherwise another model of the same provider may have them.
      const instead = route?.provider === 'google' ? 'Choose an OpenAI or Anthropic model for this party.' : 'Choose another model for this party.'
      return issue.feature === 'json'
        ? `${name} can't return answers as fields in Model Court, so it can't be a party when fields are pulled from documents. ${instead}`
        : `${name} can't call mock tools in Model Court, so it can't be a party in a tool-use hearing. ${instead}`
    }
    case 'tools_imported_unsupported':
      return "Imported answers have no tool calls, so a tool-use hearing can't include an imported party. Remove it or switch the task kit."
    case 'kit_tools_missing':
      return `Every tool-use question needs at least one tool. Add one to ${questionName(issue.caseKey, cases)}.`
    case 'kit_unknown':
      return 'This case uses a task kit this version of Model Court does not know. Choose another task kit.'
    case 'kit_sources_missing':
      return `Add at least one source to every question. ${questionName(issue.caseKey, cases)} has none.`
    case 'kit_required_source_unknown':
      return `A required source no longer exists: ${questionName(issue.caseKey, cases)} has no S${issue.number}. Check "A good answer cites".`
  }
}

/** Distinct providers a draft needs keys for (imported parties need none). */
export function requiredProviders(configurations: readonly Configuration[], routes: readonly ModelRoute[]): ProviderId[] {
  const providers = new Set<ProviderId>()
  for (const configuration of generatedParties(configurations)) {
    const route = findRoute(configuration.modelKey, routes)
    if (route) providers.add(route.provider)
  }
  return [...providers].sort()
}

export function buildSnapshot(draft: Draft, routes: readonly ModelRoute[], appCommit: string, createdAt: number, imports: readonly ImportMeta[] = []): RunSnapshot {
  const kit = draft.kit as { version: string; settings: unknown } | undefined
  const structured = needsStructuredOutput(draft)
  const tools = usesTools(draft)
  return {
    schemaVersion: 1,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    comparisonMode: draft.comparisonMode,
    cases: draft.cases,
    configurations: draft.configurations.map((configuration): SnapshotConfiguration => {
      if (isImported(configuration)) {
        return {
          ...configuration,
          source: 'imported' as const,
          imports: draft.cases.map((testCase) => {
            const meta = imports.find((item) => item.configurationKey === configuration.key && item.caseKey === testCase.key)
            if (!meta) throw new Error('buildSnapshot requires an import for every imported party and case')
            return { caseKey: testCase.key, sha256: meta.sha256, byteLength: meta.byteLength }
          }),
        }
      }
      const route = findRoute(configuration.modelKey, routes)
      if (!route) throw new Error('buildSnapshot requires validated routes')
      // Spec 04 §6.4 (D-86): a structured hearing records the route's feature successor; a plain one the plain version.
      // Spec 06 §6.1 (D-100): a tool hearing records the route's tool-loop version.
      const adapterVersion = structured ? (adapterVersionFor(route.adapterVersion, FEATURES) ?? route.adapterVersion) : tools ? (adapterVersionFor(route.adapterVersion, { toolUse: true }) ?? route.adapterVersion) : route.adapterVersion
      return { ...configuration, provider: route.provider, modelId: route.modelId, adapterVersion }
    }),
    rubricVersion: draft.rubricVersion ?? kitFor(kit?.version).defaultRubricVersion,
    messageTemplateVersion: kitFor(kit?.version).selectTemplate(draft.cases),
    providerRegistryVersion: PROVIDER_REGISTRY_VERSION,
    appCommit,
    createdAt,
    ...(draft.samplesPerAnswer ? { samplesPerAnswer: draft.samplesPerAnswer } : {}),
    ...(kit ? { kit: { version: kit.version, settings: kit.settings } } : {}),
  }
}
