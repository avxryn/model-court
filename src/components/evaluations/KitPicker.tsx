/**
 * Choose the case's task kit (spec 03 §4.2, D-79). Built like RubricPicker: one folded line until
 * changed. A switch that would clear question fields or a conversation asks first, naming what
 * goes. Hearings keep the kit they started with.
 */

import { useState } from 'react'
import { ChoiceCard, ChoiceCardGroup } from '@/components/court/ChoiceCard'
import { Fold } from '@/components/court/Fold'
import { Plain } from '@/components/court/Paper'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { DraftInput } from '@/domain/contracts'
import { KIT_VERSIONS, KITS, type KitVersion } from '@/domain/kits/registry'
import type { TaskKit } from '@/domain/kits/types'
import { draftKit, switchKit, type KitSwitch } from '@/lib/kits'

function checksLine(kit: TaskKit<unknown, unknown>): string {
  return kit.checks.length === 0 ? 'No automatic checks' : `Checks: ${kit.checks.map((check) => check.label).join(' · ')}`
}

export function KitPicker({ draft, onChange, disabled, defaultOpen = false }: { draft: DraftInput; onChange: (next: DraftInput) => void; disabled?: boolean; defaultOpen?: boolean }) {
  const current = draftKit(draft)
  const [pending, setPending] = useState<KitSwitch | null>(null)
  // A superseded version stays shown while a draft uses it, but is never offered for a new choice.
  const offered = KIT_VERSIONS.filter((version) => KITS[version].listed || version === current.version)

  const choose = (version: string) => {
    const result = switchKit(draft, version)
    if (result.removals.length > 0) setPending(result)
    else {
      setPending(null)
      onChange(result.draft)
    }
  }

  return (
    <fieldset disabled={disabled} className="mb-6">
      <legend id="kit-legend" className="court-label mb-1">
        Task kit <Plain>the kind of answer, and free checks Model Court runs on each one</Plain>
      </legend>
      <Fold
        defaultOpen={defaultOpen}
        summary={
          <span>
            <span className="font-medium text-foreground">{current.name}</span>
            <span className="hidden sm:inline"> · {current.checks.length === 0 ? 'no automatic checks' : `${current.checks.length} automatic checks`}</span>
            <span className="ml-2 underline underline-offset-4">Change</span>
          </span>
        }
      >
        <ChoiceCardGroup aria-labelledby="kit-legend" value={pending ? (pending.draft as { kit?: { version: string } }).kit?.version ?? 'general-v1' : current.version} onValueChange={choose} className="md:grid-cols-3">
          {offered.map((version: KitVersion) => {
            const kit = KITS[version] as TaskKit<unknown, unknown>
            return (
              <ChoiceCard
                key={version}
                id={`kit-${version}`}
                value={version}
                title={kit.name}
                description={
                  <>
                    {kit.description}
                    {kit.checks.length > 0 && <span className="mt-1 block">{checksLine(kit)}</span>}
                  </>
                }
              />
            )
          })}
        </ChoiceCardGroup>
        {pending && (
          <Alert className="mt-3" role="alertdialog" aria-labelledby="kit-switch-title" aria-describedby="kit-switch-body">
            <AlertTitle id="kit-switch-title">Switch the task kit?</AlertTitle>
            <AlertDescription id="kit-switch-body">
              {pending.removals.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    onChange(pending.draft)
                    setPending(null)
                  }}
                >
                  Switch and remove them
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPending(null)}>
                  Keep {current.name}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </Fold>
    </fieldset>
  )
}
