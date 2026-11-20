/**
 * Duplicate a case and export its scenario file (spec 02 §3.4, D-71). Both make no provider
 * call. A copy is a new, independent case; a file leaves the app and anyone can read it.
 */

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { api, describeError, newIntentKey, saveBlob } from '@/lib/api-client'
import { docketNumber } from '@/lib/court'

export interface CopySource {
  id: string
  number: number
}

/** "The current draft" or one hearing's frozen setup. */
function SourcePicker({ value, onChange, runs, id }: { value: string; onChange: (value: string) => void; runs: readonly CopySource[]; id: string }) {
  if (runs.length === 0) return null
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>Copy from</FieldLabel>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <option value="">The current draft</option>
        {[...runs].sort((a, b) => b.number - a.number).map((run) => (
          <option key={run.id} value={run.id}>
            Hearing {run.number}, as it was frozen
          </option>
        ))}
      </select>
    </Field>
  )
}

export function DuplicateCaseDialog({ open, onOpenChange, evaluationId, title, runs, hasImported }: { open: boolean; onOpenChange: (open: boolean) => void; evaluationId: string; title: string; runs: readonly CopySource[]; hasImported: boolean }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [parties, setParties] = useState(true)
  const [answers, setAnswers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intent = useRef(newIntentKey())
  const copy = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ id: string }>('POST', `/evaluations/${evaluationId}/duplicate`, {
        body: { title: name.trim() || `${title} (copy)`.slice(0, 120), includeParties: parties, ...(from ? { fromRunId: from } : {}), ...(parties && answers ? { includeImportedAnswers: true } : {}) },
        idempotencyKey: intent.current,
      })
      toast.success('Case copied')
      onOpenChange(false)
      navigate(`/evaluations/${result.id}`)
    } catch (caught) {
      setError(describeError(caught))
      intent.current = newIntentKey()
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
          setName('')
          setFrom('')
          setParties(true)
          setAnswers(false)
          setError(null)
          intent.current = newIntentKey()
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Duplicate case</DialogTitle>
          <DialogDescription>Copy the questions{parties ? ' and parties' : ''} into a new case. Hearings, testimony, worksheets and judgments are not copied. To ask the same questions of new parties, re-hearing this case keeps the hearings comparable side by side.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy) void copy()
          }}
        >
          <Field className="gap-1.5">
            <FieldLabel htmlFor="copy-title">Title of the copy</FieldLabel>
            <Input id="copy-title" value={name} maxLength={120} placeholder={`${title} (copy)`.slice(0, 120)} onChange={(event) => setName(event.target.value)} />
          </Field>
          <SourcePicker id="copy-from" value={from} onChange={setFrom} runs={runs} />
          <div className="space-y-3 rounded-md bg-slip p-4">
            <Field orientation="horizontal" className="items-start">
              <Checkbox id="copy-parties" checked={parties} onCheckedChange={(c) => setParties(c === true)} />
              <FieldLabel htmlFor="copy-parties" className="font-normal">
                Copy the parties too (models and system instructions). Without them, the copy starts with the default pair.
              </FieldLabel>
            </Field>
            {parties && hasImported && (
              <Field orientation="horizontal" className="items-start">
                <Checkbox id="copy-answers" checked={answers} onCheckedChange={(c) => setAnswers(c === true)} />
                <FieldLabel htmlFor="copy-answers" className="font-normal">
                  Copy imported answers too. They may be shown to the copy’s jurors, and jurors of this case have seen them.
                </FieldLabel>
              </Field>
            )}
          </div>
          <p className="text-small text-muted-foreground">The copy counts as one of your cases. Deleting either case leaves the other.</p>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Copying…' : 'Duplicate case'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ExportScenarioDialog({ open, onOpenChange, evaluationId, runs }: { open: boolean; onOpenChange: (open: boolean) => void; evaluationId: string; runs: readonly CopySource[] }) {
  const [from, setFrom] = useState('')
  const [parties, setParties] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const query = new URLSearchParams({ includeParties: String(parties), ...(from ? { fromRunId: from } : {}) })
      const file = await api<Record<string, unknown>>('GET', `/evaluations/${evaluationId}/scenario?${query}`)
      saveBlob(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), `${docketNumber(evaluationId)}-scenario.json`)
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
          setFrom('')
          setParties(false)
          setError(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export scenario file</DialogTitle>
          <DialogDescription>
            A JSON file with your questions, exhibits and jury instructions{parties ? ', and your system instructions' : ''}. Anyone you send it to can read them, and can open it as a new case of their own. No hearing, answer, score, key or account is in it.
          </DialogDescription>
        </DialogHeader>
        <SourcePicker id="export-from" value={from} onChange={setFrom} runs={runs} />
        <div className="rounded-md bg-slip p-4">
          <Field orientation="horizontal" className="items-start">
            <Checkbox id="export-parties" checked={parties} onCheckedChange={(c) => setParties(c === true)} />
            <FieldLabel htmlFor="export-parties" className="font-normal">
              Include the parties: their models and full system instructions. Imported answers are never included.
            </FieldLabel>
          </Field>
        </div>
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void download()}>
            {busy ? 'Preparing…' : 'Download file'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
