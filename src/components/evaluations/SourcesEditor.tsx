/**
 * One grounded question's sources and grounding key (spec 05 §3, D-95). Sources live beside the
 * draft, so they are saved on their own (`PUT …/sources/:caseKey`) and only on a saved draft; a
 * save reloads the case with the server's revision and draft. Moving or removing a source
 * renumbers "A good answer cites" in the same write. The key (can the sources answer this, and
 * which sources a good answer cites) is part of the draft: shown to jurors, never sent to a party.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Plain } from '@/components/court/Paper'
import type { FieldErrors } from '@/components/evaluations/DraftEditor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import type { CaseInput } from '@/domain/contracts'
import { readingMinutes, sourceList } from '@/domain/grounded/sources'
import { GROUNDED_DEFAULT_FIELDS, type Answerable, type GroundedFields } from '@/domain/kits/grounded'
import { LIMITS } from '@/domain/limits'
import { codePointLength } from '@/domain/text'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import { chars, remapRequired, rowProblems, rowsChanged, rowsOf, sourcesOf, type SourceRow } from '@/lib/sources'
import { cn } from '@/lib/utils'

const G = LIMITS.grounded

export interface SavedSource {
  number: number
  title: string | null
  origin: string | null
  text: string
}

export interface GroundedSourcesValue {
  evaluationId: string
  revision: number
  /** False while the draft has unsaved edits: sources can be saved only on a saved draft. */
  saved: boolean
  sources: ReadonlyArray<{ caseKey: string; items: readonly SavedSource[] }>
  onSaved: () => void
}

const SourcesContext = createContext<GroundedSourcesValue | null>(null)

export function GroundedSourcesProvider({ value, children }: { value: GroundedSourcesValue; children: ReactNode }) {
  return <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>
}

export function useGroundedSources(): GroundedSourcesValue | null {
  return useContext(SourcesContext)
}

const ANSWERABLE_LABELS: Record<Answerable, { title: string; hint: string }> = {
  yes: { title: 'Yes', hint: 'The sources contain the answer.' },
  partly: { title: 'Partly', hint: 'They answer part of it; a good answer says what is missing.' },
  no: { title: 'No', hint: 'They do not; a good answer says so.' },
}

export function GroundedQuestionFields({ testCase, index, errors, onChange }: { testCase: CaseInput; index: number; errors: FieldErrors; onChange: (patch: Partial<CaseInput>) => void }) {
  const context = useGroundedSources()
  const saved = useMemo(() => context?.sources.find((entry) => entry.caseKey === testCase.key)?.items ?? [], [context?.sources, testCase.key])
  const fields: GroundedFields = (testCase.kitFields as GroundedFields | undefined)?.kind === 'grounded' ? (testCase.kitFields as GroundedFields) : GROUNDED_DEFAULT_FIELDS
  const setFields = (patch: Partial<GroundedFields>) => onChange({ kitFields: { ...fields, ...patch } })
  const [rows, setRows] = useState<SourceRow[]>(() => rowsOf(saved, newIntentKey))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = (field: string) => `case-${testCase.key}-${field}`
  const changed = rowsChanged(rows, saved)
  const others = (context?.sources ?? []).filter((entry) => entry.caseKey !== testCase.key)
  const otherChars = chars(others.flatMap((entry) => entry.items.map((item) => item.text)))
  const questionChars = chars(rows.map((row) => row.text))
  const problems = rowProblems(rows, otherChars)
  const remap = remapRequired(fields.requiredSources, rows)
  const minutes = readingMinutes([...others.flatMap((entry) => entry.items.map((item) => item.text)), ...rows.map((row) => row.text)])
  const requiredError = Object.entries(errors).find(([path]) => path.startsWith(`cases.${index}.kitFields`))?.[1]

  const update = (rowIndex: number, patch: Partial<SourceRow>) => setRows(rows.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)))
  const move = (rowIndex: number, delta: number) => {
    const next = [...rows]
    const [row] = next.splice(rowIndex, 1)
    next.splice(rowIndex + delta, 0, row)
    setRows(next)
  }

  const save = async () => {
    if (!context) return
    setBusy(true)
    setError(null)
    try {
      await api('PUT', `/evaluations/${context.evaluationId}/sources/${testCase.key}`, {
        body: { sources: sourcesOf(rows), ...(fields.answerable !== 'no' ? { requiredSources: remap.required } : {}) },
        revision: context.revision,
      })
      toast.success('Sources saved')
      context.onSaved()
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.fields.length ? caught.fields.map((field) => field.message).join(' ') : describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  const removeAll = async () => {
    if (!context) return
    setBusy(true)
    setError(null)
    try {
      await api('DELETE', `/evaluations/${context.evaluationId}/sources/${testCase.key}`, { revision: context.revision })
      toast.success('Sources removed')
      context.onSaved()
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  const canEdit = !!context?.saved
  // D-120: a disabled Save says why, beside it.
  const saveBlocker = !canEdit ? 'Save the draft first.' : !changed ? (saved.length > 0 ? 'Saved. Change a source to save again.' : 'Add a source to save.') : problems.length > 0 ? 'Fix the problems below first.' : null
  return (
    <div className="space-y-5 border-t border-paper-rule pt-4 md:col-span-2">
      <div className="space-y-1">
        <p className="court-label">
          Sources{saved.length > 0 ? ` · Exhibits S1–S${saved.length}` : ''} <Plain>the passages every party receives</Plain>
        </p>
        <p className="text-caption text-muted-foreground">Sources are sent to every party’s provider and shown to your jurors. Notes stay with you and the record: they are never sent and never shown to jurors.</p>
      </div>
      {!canEdit && <p className="rounded-md bg-slip px-3 py-2 text-small text-muted-foreground">Save the draft, then add or change this question’s sources.</p>}
      <ol className="space-y-3" aria-label={`Sources of question ${index + 1}`}>
        {rows.map((row, rowIndex) => {
          const length = codePointLength(row.text)
          return (
            <li key={row.id} className="space-y-2 rounded-md border border-paper-rule px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="typewriter text-small font-medium">S{rowIndex + 1}</span>
                <div className="flex gap-1">
                  <Button size="icon-sm" variant="ghost" aria-label={`Move S${rowIndex + 1} up`} disabled={!canEdit || rowIndex === 0} onClick={() => move(rowIndex, -1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Move S${rowIndex + 1} down`} disabled={!canEdit || rowIndex === rows.length - 1} onClick={() => move(rowIndex, 1)}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove S${rowIndex + 1}`} disabled={!canEdit} onClick={() => setRows(rows.filter((_, i) => i !== rowIndex))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field className="gap-1">
                  <FieldLabel htmlFor={id(`${row.id}-title`)} className="text-small">Title (optional)</FieldLabel>
                  <Input id={id(`${row.id}-title`)} value={row.title} disabled={!canEdit} onChange={(event) => update(rowIndex, { title: event.target.value })} />
                </Field>
                <Field className="gap-1">
                  <FieldLabel htmlFor={id(`${row.id}-origin`)} className="text-small">Your note (optional, never sent)</FieldLabel>
                  <Input id={id(`${row.id}-origin`)} value={row.origin} placeholder="kb-1432, retrieved Nov 12" disabled={!canEdit} onChange={(event) => update(rowIndex, { origin: event.target.value })} />
                </Field>
              </div>
              <Field className="gap-1">
                <FieldLabel htmlFor={id(`${row.id}-text`)} className="text-small">Text (sent to the models exactly as written)</FieldLabel>
                <Textarea id={id(`${row.id}-text`)} rows={4} value={row.text} disabled={!canEdit} aria-describedby={id(`${row.id}-count`)} aria-invalid={length > G.sourceText.max || undefined} onChange={(event) => update(rowIndex, { text: event.target.value })} />
                <FieldDescription id={id(`${row.id}-count`)} className={cn('text-right text-caption tabular-nums', length > G.sourceText.max && 'text-destructive')}>
                  {length.toLocaleString('en-US')}/{G.sourceText.max.toLocaleString('en-US')}
                </FieldDescription>
              </Field>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!canEdit || rows.length >= G.sourcesPerQuestion.max} onClick={() => setRows([...rows, { id: newIntentKey(), savedNumber: null, title: '', text: '', origin: '' }])}>
          <Plus aria-hidden /> Add a source ({rows.length}/{G.sourcesPerQuestion.max})
        </Button>
        <Button size="sm" disabled={busy || saveBlocker !== null} aria-describedby={saveBlocker && canEdit ? id('save-blocker') : undefined} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save sources'}
        </Button>
        {saved.length > 0 && (
          <Button size="sm" variant="ghost" disabled={!canEdit || busy} onClick={() => void removeAll()}>
            Remove all sources
          </Button>
        )}
        {/* Without a saved draft, the note above the list already says why. */}
        {saveBlocker && canEdit && !busy && (
          <span id={id('save-blocker')} className="text-caption text-muted-foreground">
            {saveBlocker}
          </span>
        )}
      </div>
      <p className="text-caption text-muted-foreground tabular-nums" aria-live="polite">
        This question: {questionChars.toLocaleString('en-US')}/{G.questionChars.toLocaleString('en-US')} characters · the case: {(questionChars + otherChars).toLocaleString('en-US')}/{G.caseChars.toLocaleString('en-US')}
        {minutes > 0 && ` · about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} of reading for each juror`}
        {changed && ' · not saved yet'}
      </p>
      {changed && remap.dropped.length > 0 && fields.answerable !== 'no' && (
        <p className="text-small text-warning">{sourceList(remap.dropped)} {remap.dropped.length === 1 ? 'was' : 'were'} required. Saving unticks {remap.dropped.length === 1 ? 'it' : 'them'} under “A good answer cites”.</p>
      )}
      {changed && problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-small text-destructive">
          {problems.slice(0, 5).map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-small text-destructive" role="alert">{error}</p>}

      <Field className="gap-2">
        <Label id={id('answerable-label')} className="font-medium">
          Can the sources answer this? <Plain>part of the jury instructions; never sent to the models</Plain>
        </Label>
        <RadioGroup aria-labelledby={id('answerable-label')} value={fields.answerable} onValueChange={(value) => setFields(value === 'no' ? { answerable: 'no', requiredSources: [] } : { answerable: value as Answerable })} className="gap-2 sm:grid-cols-3">
          {(Object.keys(ANSWERABLE_LABELS) as Answerable[]).map((value) => (
            <label key={value} htmlFor={id(`answerable-${value}`)} className="flex cursor-pointer items-start gap-2 rounded-md border border-paper-rule px-3 py-2 text-small">
              <RadioGroupItem id={id(`answerable-${value}`)} value={value} className="mt-0.5" />
              <span>
                <span className="font-medium">{ANSWERABLE_LABELS[value].title}</span>
                <span className="block text-caption text-muted-foreground">{ANSWERABLE_LABELS[value].hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </Field>
      {fields.answerable !== 'no' && (
        <fieldset className="space-y-2">
          <legend className="text-small font-medium">A good answer cites</legend>
          {saved.length === 0 ? (
            <p className="text-caption text-muted-foreground">Save the sources first.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {saved.map((source) => (
                <div key={source.number} className="flex items-center gap-1.5">
                  <Checkbox
                    id={id(`required-${source.number}`)}
                    checked={fields.requiredSources.includes(source.number)}
                    disabled={changed}
                    onCheckedChange={(checked) => setFields({ requiredSources: (checked === true ? [...fields.requiredSources, source.number] : fields.requiredSources.filter((n) => n !== source.number)).sort((a, b) => a - b) })}
                  />
                  <Label htmlFor={id(`required-${source.number}`)} className="font-normal">
                    S{source.number}
                    {source.title ? <span className="text-muted-foreground"> · {source.title}</span> : null}
                  </Label>
                </div>
              ))}
            </div>
          )}
          {changed && saved.length > 0 && <p className="text-caption text-muted-foreground">Save the sources first; the ticks follow each source when it moves.</p>}
          {requiredError && <p className="text-caption text-destructive">{requiredError}</p>}
        </fieldset>
      )}
    </div>
  )
}
