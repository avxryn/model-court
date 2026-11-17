import { useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { CASE_TEMPLATES } from '@/lib/templates'

/** Open a new case from a starter template. `trigger` replaces the default "Open a new case" button. */
export function NewCaseDialog({ trigger }: { trigger?: ReactElement }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [templateId, setTemplateId] = useState(CASE_TEMPLATES[0].id)
  const [title, setTitle] = useState(CASE_TEMPLATES[0].title)
  const [task, setTask] = useState(CASE_TEMPLATES[0].task)
  const template = CASE_TEMPLATES.find((t) => t.id === templateId) ?? CASE_TEMPLATES[0]
  const pickTemplate = (id: string) => {
    const next = CASE_TEMPLATES.find((t) => t.id === id) ?? CASE_TEMPLATES[0]
    setTemplateId(next.id)
    setTitle(next.title)
    setTask(next.task)
  }
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ id: string }>('POST', '/evaluations', { body: { title: title.trim(), taskDescription: task.trim() } })
      if (template.apply) {
        try {
          const created = await api<OwnerEvaluationView>('GET', `/evaluations/${result.id}`)
          const seed: DraftInput = { comparisonMode: created.draft.comparisonMode, cases: created.draft.cases, configurations: created.draft.configurations }
          await api('PUT', `/evaluations/${result.id}/draft`, { body: template.apply(seed, newIntentKey), revision: created.revision })
        } catch {
          toast.error('The case was opened with the default example; the template could not be applied.')
        }
      }
      setOpen(false)
      navigate(`/evaluations/${result.id}`)
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.fields.length ? caught.fields.map((f) => f.message).join(' ') : describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger} />
      ) : (
        <DialogTrigger render={<Button />}>
          <Plus aria-hidden /> Open a new case
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">Open a new case</DialogTitle>
          <DialogDescription>Start from a template. You can edit every question, exhibit, and party before the first hearing.</DialogDescription>
        </DialogHeader>
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
            <Input id="eval-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="eval-task">Decision you want to make</FieldLabel>
            <Textarea id="eval-task" value={task} maxLength={2000} rows={3} onChange={(e) => setTask(e.target.value)} />
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? 'Opening…' : 'Open case'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
