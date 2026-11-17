/** Display helpers for parties that may be generated or imported (D-38). */

import type { Provenance } from '@/domain/contracts'
import { PROVIDER_NAMES, type ProviderId } from '@/domain/registry'

export const SOURCE_LABELS: Record<Provenance['sourceType'], string> = {
  human_baseline: 'Human-written baseline',
  transcript_export: 'Exported transcripts',
  other: 'Other source',
}

/** "OpenAI · gpt-6-luna" for a model party, "Imported · Human-written baseline" for an imported one. */
export function partySource(party: { provider: ProviderId | null; modelId: string | null; provenance?: Provenance | null }): string {
  if (party.provider && party.modelId) return `${PROVIDER_NAMES[party.provider]} · ${party.modelId}`
  return `Imported · ${party.provenance ? SOURCE_LABELS[party.provenance.sourceType] : 'outside source'}`
}
