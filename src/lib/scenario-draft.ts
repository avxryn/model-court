/**
 * The draft's parties fingerprinted as a hearing would freeze them (spec 02, D-69), so the
 * Start dialog can split calls into "asked again" and "new", and the Parties tab can warn
 * when an imported party's exact answers were already shown to earlier jurors.
 */

import { useEffect, useState } from 'react'
import { isImported, type DraftInput } from '@/domain/contracts'
import type { ModelRoute } from '@/domain/registry'
import { sha256Hex } from '@/domain/canonical'
import { partyFingerprint, questionHashes, scenarioHash, scenarioSourceOfDraft } from '@/domain/scenario'
import type { SnapshotConfiguration } from '@/domain/snapshot'

export interface DraftImport {
  configurationKey: string
  caseKey: string
  text: string
}

/** Fingerprint per draft party key; a party whose model is not in the catalog (or whose answers are incomplete) gets none. */
export async function draftPartyFingerprints(draft: Pick<DraftInput, 'cases' | 'configurations'>, routes: ReadonlyArray<Pick<ModelRoute, 'key' | 'provider' | 'modelId'>>, imports: readonly DraftImport[]): Promise<Map<string, string>> {
  const hashes = await questionHashes(draft.cases)
  const result = new Map<string, string>()
  for (const party of draft.configurations) {
    let frozen: SnapshotConfiguration | null = null
    if (isImported(party)) {
      const answers = draft.cases.map((testCase) => imports.find((item) => item.configurationKey === party.key && item.caseKey === testCase.key))
      if (answers.every((item) => item !== undefined)) frozen = { ...party, source: 'imported', imports: await Promise.all(answers.map(async (item) => ({ caseKey: item!.caseKey, sha256: await sha256Hex(item!.text), byteLength: 0 }))) }
    } else {
      const route = routes.find((r) => r.key === party.modelKey)
      if (route) frozen = { ...party, provider: route.provider, modelId: route.modelId, adapterVersion: '' }
    }
    if (frozen) result.set(party.key, await partyFingerprint(frozen, hashes))
  }
  return result
}

export function useDraftPartyFingerprints(draft: Pick<DraftInput, 'cases' | 'configurations'>, routes: ReadonlyArray<Pick<ModelRoute, 'key' | 'provider' | 'modelId'>> | null, imports: readonly DraftImport[]): Map<string, string> | null {
  const [value, setValue] = useState<Map<string, string> | null>(null)
  const signature = JSON.stringify([draft.cases, draft.configurations, imports, routes?.map((r) => [r.key, r.provider, r.modelId])])
  useEffect(() => {
    if (!routes) return
    let live = true
    void draftPartyFingerprints(draft, routes, imports).then((next) => {
      if (live) setValue(next)
    })
    return () => {
      live = false
    }
    // The signature covers every input that changes a fingerprint.
  }, [signature])
  return value
}

/** The working draft's scenario hash, recomputed as the judge edits (null until the first hash is ready). */
export function useDraftScenarioHash(draft: Pick<DraftInput, 'cases' | 'rubricVersion'>): string | null {
  const [value, setValue] = useState<string | null>(null)
  const signature = JSON.stringify([draft.cases, draft.rubricVersion ?? null, (draft as Record<string, unknown>).kit ?? null])
  useEffect(() => {
    let live = true
    void scenarioHash(scenarioSourceOfDraft(draft)).then((next) => {
      if (live) setValue(next)
    })
    return () => {
      live = false
    }
  }, [signature])
  return value
}
