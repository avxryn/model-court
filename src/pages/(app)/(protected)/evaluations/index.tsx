import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Scale } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState as EmptyPanel, ErrorPanel, formatTime, Page, PageSkeleton, StaleNotice, StatusBadge } from '@/components/common'
import { DocketNumber, Sheet, Term } from '@/components/court/CaseFile'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import type { DraftInput } from '@/domain/contracts'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import { docketNumber } from '@/lib/court'
import type { EvaluationSummary, OwnerEvaluationView } from '@/lib/dto'
import { CASE_TEMPLATES } from '@/lib/templates'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/use-api'

export default function EvaluationsPage() {
  const [cursor, setCursor] = useState<string | null>(null)
  const list = useApi<{ items: EvaluationSummary[]; nextCursor: string | null }>(`/evaluations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)

  return (
    <Page>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="court-label">
            <Term name="docket" />
          </div>
          <h1 className="font-heading text-3xl leading-tight font-bold">Your cases</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Compare two AI setups on your own questions, have a jury score the answers blind, then enter judgment.</p>
        </div>
        <CreateEvaluationDialog />
      </header>
      {list.stale && <StaleNotice onRetry={list.reload} />}
      {list.loading && !list.data ? (
        <PageSkeleton label="Loading your cases" />
      ) : list.error && !list.data ? (
        <ErrorPanel error={list.error} onRetry={list.reload} />
      ) : list.data && list.data.items.length === 0 && !cursor ? (
        <EmptyState />
      ) : (
        <>
          <Sheet as="div" margin={false}>
          <ul className="divide-y divide-paper-rule">
            {list.data?.items.map((item) => (
              <li key={item.id}>
                <Link to={`/evaluations/${item.id}`} className="flex flex-col gap-1.5 px-5 py-4 transition-colors duration-150 hover:bg-slip focus-visible:bg-slip focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4">
                  <span className="shrink-0 text-xs text-muted-foreground sm:w-32">
                    <DocketNumber>{docketNumber(item.id)}</DocketNumber>
                  </span>
                  <span className="min-w-0 flex-1 truncate font-heading text-base">
                    <span className="italic">In re:</span> <span className="font-bold">{item.title}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className={cn('typewriter rounded-[3px] px-2 py-0.5 font-bold', item.role === 'owner' ? 'bg-foreground text-paper' : 'bg-sticker text-sticker-foreground')}>{item.role === 'owner' ? 'JUDGE' : 'JUROR'}</span>
                    {item.latestRunStatus ? <StatusBadge status={item.latestRunStatus} /> : <span>No hearings yet</span>}
                    <span className="tabular-nums">{formatTime(item.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          </Sheet>
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" size="sm" disabled={!cursor} onClick={() => setCursor(null)}>
              First page
            </Button>
            <Button variant="outline" size="sm" disabled={!list.data?.nextCursor} onClick={() => setCursor(list.data?.nextCursor ?? null)}>
              Older cases
            </Button>
          </div>
        </>
      )}
    </Page>
  )
}

function EmptyState() {
  return (
    <EmptyPanel
      icon={Scale}
      title="Open your first case"
      actions={
        <>
          <CreateEvaluationDialog />
          <Button variant="outline" render={<Link to="/sample" />} nativeButton={false}>
            Explore the sample
          </Button>
        </>
      }
    >
      <p>Pick a starter template, edit the questions, and add your provider keys. The sample case shows the whole process without keys.</p>
    </EmptyPanel>
  )
}

function CreateEvaluationDialog() {
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
  const triggerRef = useRef<HTMLButtonElement>(null)

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
      <DialogTrigger render={<Button ref={triggerRef} />}>
        <Plus aria-hidden /> Open a new case
      </DialogTrigger>
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
            <RadioGroup aria-labelledby="template-legend" value={templateId} onValueChange={(v) => pickTemplate(String(v))} className="grid gap-2">
              {CASE_TEMPLATES.map((t) => (
                <Label key={t.id} htmlFor={`template-${t.id}`} className={cn('flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 font-normal transition-colors duration-150', templateId === t.id ? 'border-foreground bg-slip' : 'border-paper-edge bg-white hover:bg-slip/60')}>
                  <RadioGroupItem id={`template-${t.id}`} value={t.id} className="mt-0.5" aria-labelledby={`template-${t.id}-text`} />
                  <span id={`template-${t.id}-text`} className="leading-snug">
                    <span className="block font-medium text-foreground">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">{t.useCase}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="eval-title">Case title</Label>
            <Input id="eval-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eval-task">Decision you want to make</Label>
            <Textarea id="eval-task" value={task} maxLength={2000} rows={3} onChange={(e) => setTask(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
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
