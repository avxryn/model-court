import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Scale } from 'lucide-react'
import { EmptyState as EmptyPanel, ErrorPanel, formatTime, Page, PageHeader, PageSkeleton, StaleNotice, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiClientError, describeError } from '@/lib/api-client'
import type { EvaluationSummary } from '@/lib/dto'
import { useApi } from '@/lib/use-api'

export default function EvaluationsPage() {
  const [cursor, setCursor] = useState<string | null>(null)
  const list = useApi<{ items: EvaluationSummary[]; nextCursor: string | null }>(`/evaluations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)

  return (
    <Page>
      <PageHeader title="Evaluations" description="Compare two AI configurations on your own cases, review responses blind, then record a verdict." actions={<CreateEvaluationDialog />} />
      {list.stale && <StaleNotice onRetry={list.reload} />}
      {list.loading && !list.data ? (
        <PageSkeleton label="Loading evaluations" />
      ) : list.error && !list.data ? (
        <ErrorPanel error={list.error} onRetry={list.reload} />
      ) : list.data && list.data.items.length === 0 && !cursor ? (
        <EmptyState />
      ) : (
        <>
          <ul className="surface divide-y divide-border overflow-hidden">
            {list.data?.items.map((item) => (
              <li key={item.id}>
                <Link to={`/evaluations/${item.id}`} className="flex flex-col gap-1.5 px-5 py-4 transition-colors duration-150 hover:bg-secondary/50 focus-visible:bg-secondary/60 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4">
                  <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">{item.role === 'owner' ? 'Owner' : 'Reviewer'}</span>
                    {item.latestRunStatus ? <StatusBadge status={item.latestRunStatus} /> : <span>No runs yet</span>}
                    <span className="tabular-nums">{formatTime(item.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" size="sm" disabled={!cursor} onClick={() => setCursor(null)}>
              First page
            </Button>
            <Button variant="outline" size="sm" disabled={!list.data?.nextCursor} onClick={() => setCursor(list.data?.nextCursor ?? null)}>
              Older evaluations
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
      title="No evaluations yet"
      actions={
        <>
          <CreateEvaluationDialog />
          <Button variant="outline" render={<Link to="/sample" />} nativeButton={false}>
            Explore the sample
          </Button>
        </>
      }
    >
      <p>A new evaluation starts with a five-case customer-support example you can edit or replace. You will need your own provider keys to run it.</p>
    </EmptyPanel>
  )
}

function CreateEvaluationDialog() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('Support policy answers')
  const [task, setTask] = useState('Which configuration answers return-policy questions accurately from the supplied policy?')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ id: string }>('POST', '/evaluations', { body: { title: title.trim(), taskDescription: task.trim() } })
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
        <Plus aria-hidden /> New evaluation
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New evaluation</DialogTitle>
          <DialogDescription>You can edit everything, including the seeded example cases, before running.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="eval-title">Title</Label>
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
              {busy ? 'Creating…' : 'Create evaluation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
