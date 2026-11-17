/**
 * Immutable run snapshot (spec §5.3) and the readiness rules that decide
 * whether a draft can start a run. Shared by the editor and run admission.
 */

import { CANONICALIZATION_VERSION } from './canonical'
import type { CaseInput, ComparisonMode, Configuration, Draft } from './contracts'
import { MESSAGE_TEMPLATE_VERSION } from './messages'
import { findRoute, isRouteEnabled, PROVIDER_REGISTRY_VERSION, type ModelRoute, type ProviderId } from './registry'
import { RUBRIC_VERSION } from './rubric'

export interface SnapshotConfiguration extends Configuration {
  provider: ProviderId
  modelId: string
  adapterVersion: string
}

export interface RunSnapshot {
  schemaVersion: 1
  canonicalizationVersion: typeof CANONICALIZATION_VERSION
  comparisonMode: ComparisonMode
  cases: CaseInput[]
  configurations: SnapshotConfiguration[]
  rubricVersion: typeof RUBRIC_VERSION
  messageTemplateVersion: typeof MESSAGE_TEMPLATE_VERSION
  providerRegistryVersion: string
  appCommit: string
  createdAt: number
}

export type ReadinessIssue =
  | { kind: 'unknown_model'; configurationKey: string }
  | { kind: 'model_unavailable'; configurationKey: string; modelKey: string }
  | { kind: 'model_mode_instructions_differ' }
  | { kind: 'model_mode_same_model' }

export function readinessIssues(draft: Pick<Draft, 'comparisonMode' | 'configurations'>, routes: readonly ModelRoute[]): ReadinessIssue[] {
  const issues: ReadinessIssue[] = []
  for (const configuration of draft.configurations) {
    const route = findRoute(configuration.modelKey, routes)
    if (!route) issues.push({ kind: 'unknown_model', configurationKey: configuration.key })
    else if (!isRouteEnabled(route)) issues.push({ kind: 'model_unavailable', configurationKey: configuration.key, modelKey: route.key })
  }
  if (draft.comparisonMode === 'model') {
    const prompts = new Set(draft.configurations.map((configuration) => configuration.systemPrompt))
    if (prompts.size > 1) issues.push({ kind: 'model_mode_instructions_differ' })
    const models = new Set(draft.configurations.map((configuration) => configuration.modelKey))
    if (models.size < draft.configurations.length) issues.push({ kind: 'model_mode_same_model' })
  }
  return issues
}

export function describeIssue(issue: ReadinessIssue): string {
  switch (issue.kind) {
    case 'unknown_model':
      return 'A configuration uses a model that is not in the catalog.'
    case 'model_unavailable':
      return 'A selected model route has not been verified with a real call yet, so it cannot run.'
    case 'model_mode_instructions_differ':
      return 'Model comparison requires identical system instructions. Switch to configuration comparison to vary them.'
    case 'model_mode_same_model':
      return 'Model comparison needs two different models.'
  }
}

/** Distinct providers a draft needs keys for. */
export function requiredProviders(configurations: readonly Pick<Configuration, 'modelKey'>[], routes: readonly ModelRoute[]): ProviderId[] {
  const providers = new Set<ProviderId>()
  for (const configuration of configurations) {
    const route = findRoute(configuration.modelKey, routes)
    if (route) providers.add(route.provider)
  }
  return [...providers].sort()
}

export function buildSnapshot(draft: Draft, routes: readonly ModelRoute[], appCommit: string, createdAt: number): RunSnapshot {
  return {
    schemaVersion: 1,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    comparisonMode: draft.comparisonMode,
    cases: draft.cases,
    configurations: draft.configurations.map((configuration) => {
      const route = findRoute(configuration.modelKey, routes)
      if (!route) throw new Error('buildSnapshot requires validated routes')
      return { ...configuration, provider: route.provider, modelId: route.modelId, adapterVersion: route.adapterVersion }
    }),
    rubricVersion: RUBRIC_VERSION,
    messageTemplateVersion: MESSAGE_TEMPLATE_VERSION,
    providerRegistryVersion: PROVIDER_REGISTRY_VERSION,
    appCommit,
    createdAt,
  }
}
