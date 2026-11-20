import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { api, describeError } from '@/lib/api-client'

export interface RehearSource {
  id: string
  number: number
  scenarioVersion: number
  scenarioHash: string
}

/**
 * Re-hear (spec 02 §3.2, D-69): copy a hearing's frozen questions and/or parties back into the
 * draft, then change the parties. The hearing itself never changes; no provider call is made.
 */
export function RehearDialog({
  open,
  onOpenChange,
  evaluationId,
  revision,
  source,
  draftScenarioHash,
  dirty,
  onRestored,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  evaluationId: string
  revision: number
  source: RehearSource
  draftScenarioHash: string
  dirty: boolean
  onRestored: () => void | Promise<void>
}) {
  const questionsMatch = draftScenarioHash === source.scenarioHash
  const [questions, setQuestions] = useState(!questionsMatch)
  const [parties, setParties] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = `hearing ${source.number}`
  const what = questions && parties ? 'questions and parties' : questions ? 'questions' : 'parties'

  const restore = async () => {
    setBusy(true)
    setError(null)
    try {
      if (questions || parties) await api('POST', `/evaluations/${evaluationId}/draft/restore`, { body: { fromRunId: source.id, questions, parties }, revision })
      await onRestored()
      onOpenChange(false)
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) {
          setQuestions(!questionsMatch)
          setParties(true)
          setError(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Re-hear with different parties</DialogTitle>
          <DialogDescription>
            Start a new hearing on the same questions as {name} (v{source.scenarioVersion}), then change only the parties. Every answer is generated again and a new jury is summoned.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-md bg-slip p-4">
          {questionsMatch ? (
            <p className="text-small">Your draft already asks {name}’s questions, so they stay as they are.</p>
          ) : (
            <Field orientation="horizontal" className="items-start">
              <Checkbox id="rehear-questions" checked={questions} onCheckedChange={(c) => setQuestions(c === true)} />
              <FieldLabel htmlFor="rehear-questions" className="font-normal">
                Start from {name}’s questions, exhibits, jury instructions and rubric
              </FieldLabel>
            </Field>
          )}
          <Field orientation="horizontal" className="items-start">
            <Checkbox id="rehear-parties" checked={parties} onCheckedChange={(c) => setParties(c === true)} />
            <FieldLabel htmlFor="rehear-parties" className="font-normal">
              Start from {name}’s parties (models, system instructions, imported answers)
            </FieldLabel>
          </Field>
        </div>
        <p className="text-small text-muted-foreground">
          {questions || parties ? `This replaces your draft’s ${what} with ${name}’s. ${name.charAt(0).toUpperCase() + name.slice(1)} itself never changes.` : 'Nothing is replaced: you go to the Parties tab with your draft as it is.'}
          {dirty && (questions || parties) && ' Unsaved edits in this tab are discarded.'}
        </p>
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Keep my draft
          </Button>
          <Button disabled={busy} onClick={() => void restore()}>
            {busy ? 'Restoring…' : questions || parties ? `Restore ${what}` : 'Go to the parties'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
