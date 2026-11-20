import { ChoiceCard, ChoiceCardGroup } from '@/components/court/ChoiceCard'
import { Fold } from '@/components/court/Fold'
import { Plain } from '@/components/court/Paper'
import { plannedCalls, plannedCallsAreUpperBound } from '@/domain/quota'
import { generatedParties } from '@/domain/snapshot'
import type { DraftInput } from '@/domain/contracts'
import { plural } from '@/lib/format'

const OPTIONS = [
  { value: 1, title: 'Ask each party once', description: 'The default.' },
  { value: 2, title: 'Ask twice', description: 'Doubles the paid calls.' },
  { value: 3, title: 'Ask three times', description: 'Triples the paid calls.' },
] as const

const NAMES: Record<number, string> = { 1: 'Once', 2: 'Twice', 3: 'Three times' }

/**
 * Repeats (D-66): how many times each generated party answers each question. Jurors still score
 * one answer per party; the others are on the record after unsealing. Hidden when every party is
 * imported, or when the deployment allows only one sample.
 */
export function RepeatsPicker({ draft, max, onChange, disabled }: { draft: DraftInput; max: number; onChange: (samples: 1 | 2 | 3) => void; disabled?: boolean }) {
  const generated = generatedParties(draft.configurations).length
  if (generated === 0 || max <= 1) return null
  const current = draft.samplesPerAnswer ?? 1
  const calls = plannedCalls(draft)
  // Spec 06 §5.2: a tool question may take up to its step cap per answer.
  const upTo = plannedCallsAreUpperBound(draft)
  const imported = draft.configurations.length - generated
  return (
    <fieldset disabled={disabled} className="mt-8">
      <legend id="repeats-legend" className="court-label mb-1">
        Repeats <Plain>does a setup give the same answer twice?</Plain>
      </legend>
      <Fold
        summary={
          <span className="tabular-nums">
            <span className="font-medium text-foreground">{NAMES[current]}</span>
            <span className="hidden sm:inline"> · {plural(calls, 'paid call')}</span>
            <span className="ml-2 underline underline-offset-4">Change</span>
          </span>
        }
      >
        <ChoiceCardGroup aria-labelledby="repeats-legend" value={String(current)} onValueChange={(v) => onChange(Number(v) as 1 | 2 | 3)} className="md:grid-cols-3">
          {OPTIONS.map((option) => (
            <ChoiceCard key={option.value} id={`repeats-${option.value}`} value={String(option.value)} title={option.title} description={option.description} disabled={option.value > max} />
          ))}
        </ChoiceCardGroup>
      </Fold>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Repeats show whether a setup gives the same answer each time. Jurors still score one answer per party; you can read the others on the record after unsealing.
        {imported > 0 && ' Imported answers are used once.'}
      </p>
      <p className="mt-1 text-sm tabular-nums" aria-live="polite">
        This hearing makes {upTo && 'up to '}<strong>{plural(calls, 'paid call')}</strong> ({plural(draft.cases.length, 'question')} × {plural(generated, 'model party', 'model parties')}
        {current > 1 && <> × {current} samples</>}
        {upTo && <> × each question’s step cap</>}), billed to your keys.
      </p>
    </fieldset>
  )
}
