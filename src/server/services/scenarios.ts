/**
 * Scenario versions of a case (spec 02, D-68): which hearings asked the same
 * questions, and what changed between them. Computed on read from the
 * immutable `snapshot_json`, so nothing is stored or backfilled.
 */

import type { Draft } from '../../domain/contracts'
import { diffIsEmpty, diffParties, diffScenarios, partyFingerprint, questionHashes, scenarioHash, scenarioSourceOfDraft, scenarioSourceOfSnapshot, type PartyChange, type ScenarioDiff } from '../../domain/scenario'
import { isImportedSnapshot, type RunSnapshot } from '../../domain/snapshot'
import type { RunStatus } from '../../domain/transitions'
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

