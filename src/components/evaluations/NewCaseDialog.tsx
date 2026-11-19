import { useEffect, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from 'deepspace'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { ChoiceCard, ChoiceCardGroup } from '@/components/court/ChoiceCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { DraftInput } from '@/domain/contracts'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { OwnerEvaluationView } from '@/lib/dto'
import { clearNewCaseDraft, isEmptyDraft, readNewCaseDraft, writeNewCaseDraft } from '@/lib/new-case-draft'
import { CASE_TEMPLATES } from '@/lib/templates'
import { ScenarioImport } from './ScenarioImport'

/**
 * Open a new case from a starter template. `trigger` replaces the default
 * "Open a new case" button. What the judge types is kept as a draft in this
 * browser (per user) until the case opens or the draft is discarded.
 */
export function NewCaseDialog({ trigger }: { trigger?: ReactElement }) {
  const navigate = useNavigate()
  const { userId } = useAuth()
  const [open, setOpen] = useState(false)
  const [restored, setRestored] = useState(false)
  const [templateId, setTemplateId] = useState(CASE_TEMPLATES[0].id)
  // Empty fields with the template's example as the placeholder: typing replaces
  // the example instead of being appended to it. Left empty, the example is used.
  const [title, setTitle] = useState('')
  const [task, setTask] = useState('')
  const template = CASE_TEMPLATES.find((t) => t.id === templateId) ?? CASE_TEMPLATES[0]
  const pickTemplate = (id: string) => {
    const next = CASE_TEMPLATES.find((t) => t.id === id) ?? CASE_TEMPLATES[0]
    setTemplateId(next.id)
  }
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Spec 02 (D-71): open the case from a scenario file or certified record instead of a template.
  const [importing, setImporting] = useState(false)

  // Autosave while the dialog is open; an untouched form leaves no draft behind.
  useEffect(() => {
    if (!open) return
    const draft = { templateId, title, task }
    if (isEmptyDraft(draft, CASE_TEMPLATES[0].id)) clearNewCaseDraft(userId)
    else writeNewCaseDraft(userId, draft)
  }, [open, userId, templateId, title, task])

  const reset = () => {
    setTemplateId(CASE_TEMPLATES[0].id)
    setTitle('')
    setTask('')
    setRestored(false)
  }
  const discardDraft = () => {
    clearNewCaseDraft(userId)
    reset()
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ id: string }>('POST', '/evaluations', { body: { title: title.trim() || template.title, taskDescription: task.trim() || template.task } })
      if (template.apply) {
        try {
          const created = await api<OwnerEvaluationView>('GET', `/evaluations/${result.id}`)
          const seed: DraftInput = { comparisonMode: created.draft.comparisonMode, cases: created.draft.cases, configurations: created.draft.configurations }
          await api('PUT', `/evaluations/${result.id}/draft`, { body: template.apply(seed, newIntentKey), revision: created.revision })
        } catch {
          toast.error('The case was opened with the default example; the template could not be applied.')
        }
      }
      clearNewCaseDraft(userId)
      reset()
      setOpen(false)
      navigate(`/evaluations/${result.id}`)
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.fields.length ? caught.fields.map((f) => f.message).join(' ') : describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setError(null)
          setImporting(false)
          const draft = readNewCaseDraft(userId)
          if (draft) {
            setTemplateId(CASE_TEMPLATES.some((t) => t.id === draft.templateId) ? draft.templateId : CASE_TEMPLATES[0].id)
            setTitle(draft.title)
            setTask(draft.task)
            setRestored(true)
          } else {
            reset()
          }
        }
      }}
    >
      {trigger ? (
        <DialogTrigger render={trigger} />
      ) : (
        <DialogTrigger render={<Button />}>
          <Plus aria-hidden /> Open a new case
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-medium">Open a new case</DialogTitle>
          <DialogDescription>
            {importing ? 'Open a scenario file someone exported from Model Court, or the questions of a certified record.' : 'Start from a template. You can edit every question, exhibit, and party before the first hearing.'}{' '}
            {!importing && (
              <Button type="button" variant="link" size="xs" className="h-auto p-0 align-baseline text-sm" onClick={() => setImporting(true)}>
                Import a scenario file instead
              </Button>
            )}
          </DialogDescription>
        </DialogHeader>
        {importing ? (
          <ScenarioImport onCancel={() => setImporting(false)} onCreated={() => setOpen(false)} />
        ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <fieldset className="space-y-2">
            <legend id="template-legend" className="mb-2 text-sm font-medium">Template</legend>
            <ChoiceCardGroup aria-labelledby="template-legend" value={templateId} onValueChange={pickTemplate}>
              {CASE_TEMPLATES.map((t) => (
                <ChoiceCard key={t.id} id={`template-${t.id}`} value={t.id} title={t.name} description={t.useCase} />
              ))}
            </ChoiceCardGroup>
          </fieldset>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="eval-title">Case title</FieldLabel>
            <Input id="eval-title" value={title} maxLength={120} placeholder={template.title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="eval-task">Decision you want to make</FieldLabel>
            <Textarea id="eval-task" value={task} maxLength={2000} rows={3} placeholder={template.task} onChange={(e) => setTask(e.target.value)} />
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter className="items-center">
            {restored && (
              <p className="mr-auto text-xs text-muted-foreground" role="status">
                Restored your unsent draft.{' '}
                <Button type="button" variant="link" size="xs" className="h-auto p-0 text-xs" onClick={discardDraft}>
                  Discard draft
                </Button>
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Opening…' : 'Open case'}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
