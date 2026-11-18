import { SheetSection, Term } from '@/components/court/CaseFile'
import { Fold } from '@/components/court/Fold'
import { Panel } from '@/components/court/Paper'
import type { ResultsView } from '@/lib/dto'
import { partySource } from '@/lib/parties'

/** Who each party was, with its source; system instructions fold away. */
export function PartiesSection({ data }: { data: ResultsView }) {
  return (
    <SheetSection id="mapping" label={<Term name="parties" />}>
      <div className="grid gap-4 md:grid-cols-2">
        {data.configurations.map((c) => (
          <Panel key={c.key} className="px-5 py-4">
            <h3 className="text-base font-semibold">{c.label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {partySource(c)}
              {c.maxOutputTokens && <> · {c.maxOutputTokens}-token cap</>}
            </p>
            {c.provenance ? (
              <p className="mt-3 rounded-md bg-slip p-3 font-heading text-sm leading-relaxed">
                {c.provenance.description}
                {c.provenance.collectedOn && <span className="text-muted-foreground"> · collected {c.provenance.collectedOn}</span>}
                {c.provenance.redacted && <span className="text-muted-foreground"> · redacted before review</span>}
              </p>
            ) : (
              <Fold className="mt-2" summary="System instructions">
                <p className="rounded-md bg-slip p-3 font-heading text-sm leading-relaxed whitespace-pre-wrap">{c.systemPrompt}</p>
              </Fold>
            )}
          </Panel>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {data.comparisonMode === 'model' ? 'Model comparison' : 'Configuration comparison — differences may come from instructions, not only the model'} · rubric {data.rubricVersion} · snapshot {data.snapshotHash.slice(0, 12)}…
      </p>
    </SheetSection>
  )
}
