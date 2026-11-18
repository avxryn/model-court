/**
 * Immutable run snapshot (spec §5.3) and the readiness rules that decide
 * whether a draft can start a run. Shared by the editor and run admission.
 */

import { CANONICALIZATION_VERSION } from './canonical'
import { isImported, type CaseInput, type ComparisonMode, type Configuration, type Draft, type ImportedConfiguration, type ModelConfiguration } from './contracts'
import { templateFor, type MessageTemplateVersion } from './messages'
import { findRoute, isRouteEnabled, PROVIDER_NAMES, PROVIDER_REGISTRY_VERSION, type ModelRoute, type ProviderId } from './registry'
import { RUBRIC_VERSION, type RubricVersion } from './rubric'

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

export function readinessIssues(draft: Pick<Draft, 'comparisonMode' | 'configurations'> & Partial<Pick<Draft, 'cases'>>, routes: readonly ModelRoute[]): ReadinessIssue[] {
  const issues: ReadinessIssue[] = []
  const models = generatedParties(draft.configurations)
  const hasHistory = (draft.cases ?? []).some((testCase) => (testCase.messages?.length ?? 0) > 0)
  for (const configuration of models) {
    const route = findRoute(configuration.modelKey, routes)
    if (!route) issues.push({ kind: 'unknown_model', configurationKey: configuration.key })
    else if (!isRouteEnabled(route)) issues.push({ kind: 'model_unavailable', configurationKey: configuration.key, modelKey: route.key })
    else if (hasHistory && !route.multiTurnVerifiedAt) issues.push({ kind: 'history_unverified', configurationKey: configuration.key })
  }
  if (draft.comparisonMode === 'model') {
    if (models.length < draft.configurations.length) issues.push({ kind: 'imported_requires_configuration_mode' })
    const prompts = new Set(models.map((configuration) => configuration.systemPrompt))
    if (prompts.size > 1) issues.push({ kind: 'model_mode_instructions_differ' })
    const modelKeys = new Set(models.map((configuration) => configuration.modelKey))
    if (modelKeys.size < models.length) issues.push({ kind: 'model_mode_same_model' })
  }
  return issues
}

/** Every imported party needs an answer for every question before a hearing can start. */
export function importCoverageIssues(draft: Pick<Draft, 'cases' | 'configurations'>, imports: ReadonlyArray<Pick<ImportMeta, 'configurationKey' | 'caseKey'>>): ReadinessIssue[] {
  const present = new Set(imports.map((item) => `${item.configurationKey}:${item.caseKey}`))
  return draft.configurations.filter(isImported).flatMap((configuration) =>
    draft.cases.filter((testCase) => !present.has(`${configuration.key}:${testCase.key}`)).map((testCase) => ({ kind: 'imported_text_missing' as const, configurationKey: configuration.key, caseKey: testCase.key })),
  )
}

export function describeIssue(issue: ReadinessIssue): string {
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
      return { ...configuration, provider: route.provider, modelId: route.modelId, adapterVersion: route.adapterVersion }
    }),
    rubricVersion: draft.rubricVersion ?? RUBRIC_VERSION,
    messageTemplateVersion: templateFor(draft.cases),
    providerRegistryVersion: PROVIDER_REGISTRY_VERSION,
    appCommit,
    createdAt,
    ...(draft.samplesPerAnswer ? { samplesPerAnswer: draft.samplesPerAnswer } : {}),
  }
}
