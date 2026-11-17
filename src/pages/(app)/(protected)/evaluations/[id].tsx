import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, KeyRound, Play } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorPanel, formatTime, Page, PageHeader, PageSkeleton, SaveIndicator, StatusBadge, type SaveState } from '@/components/common'
import { CasesEditor, ConfigurationsEditor, type FieldErrors } from '@/components/evaluations/DraftEditor'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { draftInputSchema, type DraftInput } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { PROVIDER_NAMES, type ModelRoute, type ProviderId } from '@/domain/registry'
import { describeIssue, readinessIssues, requiredProviders } from '@/domain/snapshot'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { CatalogView, CredentialMetadata, EvaluationView, OwnerEvaluationView } from '@/lib/dto'
import { useApi } from '@/lib/use-api'

export default function EvaluationPage() {
  const { id = '' } = useParams()
  const evaluation = useApi<EvaluationView>(`/evaluations/${id}`)
  if (evaluation.loading && !evaluation.data) return <Page width="wide"><PageSkeleton /></Page>
  if (evaluation.error && !evaluation.data) return <Page><ErrorPanel error={evaluation.error} onRetry={evaluation.reload} /></Page>
  if (!evaluation.data) return null
  if (evaluation.data.role === 'reviewer') return <ReviewerEvaluation evaluation={evaluation.data} />
  return <OwnerEvaluation key={evaluation.data.id} evaluation={evaluation.data as OwnerEvaluationView} reload={evaluation.reload} />
}

function ReviewerEvaluation({ evaluation }: { evaluation: Extract<EvaluationView, { role: 'reviewer' }> }) {
  return (
    <Page>
      <PageHeader eyebrow="Juror" title={evaluation.title} description="You were invited as a juror for this evaluation. Configuration details stay hidden until the judge reveals them." />
      <ul className="surface divide-y divide-border overflow-hidden">
        {evaluation.runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <span className="text-sm">Run started {formatTime(run.createdAt)}</span>
            <span className="flex items-center gap-3">
              <StatusBadge status={run.status} />
              <Button size="sm" variant="outline" render={<Link to={run.status === 'revealed' || run.status === 'decided' ? `/runs/${run.id}/results` : `/runs/${run.id}/review`} />} nativeButton={false}>
                Open
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Page>
  )
}

function toFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiClientError)) return {}
  return Object.fromEntries(error.fields.map((field) => [field.path, field.message]))
}

function OwnerEvaluation({ evaluation, reload }: { evaluation: OwnerEvaluationView; reload: () => Promise<void> }) {
  const catalog = useApi<CatalogView>('/catalog')
  const credentials = useApi<{ items: CredentialMetadata[] }>('/credentials')
  const [draft, setDraft] = useState<DraftInput>(() => ({ comparisonMode: evaluation.draft.comparisonMode, cases: evaluation.draft.cases, configurations: evaluation.draft.configurations }))
  const [revision, setRevision] = useState(evaluation.revision)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})

  const change = (next: DraftInput) => {
    setDraft(next)
    setDirty(true)
    setSaveState('idle')
  }

  const clientErrors = useMemo<FieldErrors>(() => {
    const parsed = draftInputSchema.safeParse(draft)
    return parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
  }, [draft])
  const errors = { ...serverErrors, ...clientErrors }
  const hasErrors = Object.keys(clientErrors).length > 0

  const routes: ModelRoute[] = useMemo(() => (catalog.data?.models ?? []).map((m) => ({ ...m, adapterVersion: '' })), [catalog.data])
  const issues = catalog.data ? readinessIssues(draft, routes) : []
  const providers = requiredProviders(draft.configurations, routes)
  const keys = credentials.data?.items ?? []
  const missingProviders = providers.filter((provider) => !keys.some((key) => key.provider === provider))
  const activeRun = evaluation.runs.find((run) => ['generating', 'ready', 'reviewing'].includes(run.status))

  const save = useCallback(async () => {
    setSaveState('saving')
    try {
      const result = await api<{ revision: number }>('PUT', `/evaluations/${evaluation.id}/draft`, { body: draft, revision })
      setRevision(result.revision)
      setDirty(false)
      setServerErrors({})
      setSaveState('saved')
    } catch (caught) {
      setServerErrors(toFieldErrors(caught))
      setSaveState(caught instanceof ApiClientError && caught.code === 'REVISION_CONFLICT' ? 'conflict' : 'error')
      if (!(caught instanceof ApiClientError && caught.fields.length)) toast.error(describeError(caught))
    }
  }, [draft, evaluation.id, revision])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const blockers: string[] = [
    ...(dirty ? ['Save the draft first — runs use the saved version.'] : []),
    ...(hasErrors ? ['Fix the highlighted fields.'] : []),
    ...issues.map(describeIssue),
    ...missingProviders.map((provider) => `Add your ${PROVIDER_NAMES[provider]} key in Settings.`),
    ...(activeRun ? ['This evaluation already has an unfinished run.'] : []),
    ...(catalog.data && !catalog.data.generationEnabled ? ['Live generation is disabled on this deployment.'] : []),
  ]

  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Evaluation"
        title={evaluation.title}
        description={evaluation.taskDescription || undefined}
        actions={
          <>
            <SaveIndicator state={dirty && saveState === 'idle' ? 'idle' : saveState} onRetry={() => void save()} />
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            <Button variant="outline" disabled={!dirty || hasErrors || saveState === 'saving'} onClick={() => void save()}>
              Save draft
            </Button>
            <RunDialog evaluationId={evaluation.id} revision={revision} draft={draft} providers={providers} keys={keys} blockers={blockers} />
          </>
        }
      />
      {saveState === 'conflict' && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle aria-hidden />
          <AlertTitle>This draft changed in another tab</AlertTitle>
          <AlertDescription>
            Your edits are still here but were not saved.{' '}
            <button className="underline" onClick={() => void reload()}>
              Reload the saved draft
            </button>{' '}
            to continue (this discards these edits).
          </AlertDescription>
        </Alert>
      )}
      {activeRun && (
        <Alert className="mb-6">
          <AlertTitle>Run in progress</AlertTitle>
          <AlertDescription>
            Edits here only affect future runs. <Link className="underline" to={`/runs/${activeRun.id}`}>Open the current run</Link>.
          </AlertDescription>
        </Alert>
      )}

      {blockers.length > 0 && (
        <div role="status" className="mb-8 rounded-xl bg-accent/60 px-5 py-4 text-sm ring-1 ring-brass/25">
          <div className="font-medium text-accent-foreground">Before you can run</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground/80 marker:text-brass">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <Tabs defaultValue="cases">
        <TabsList>
          <TabsTrigger value="cases">Cases ({draft.cases.length})</TabsTrigger>
          <TabsTrigger value="configurations">Configurations</TabsTrigger>
          <TabsTrigger value="runs">Runs ({evaluation.runs.length})</TabsTrigger>
          <TabsTrigger value="settings">Delete</TabsTrigger>
        </TabsList>
        <TabsContent value="cases" className="pt-6">
          <CasesEditor cases={draft.cases} errors={errors} newId={newIntentKey} onChange={(cases) => change({ ...draft, cases })} />
        </TabsContent>
        <TabsContent value="configurations" className="pt-6">
          <ConfigurationsEditor draft={draft} catalog={catalog.data} errors={errors} onChange={change} />
          <KeyStatus providers={providers} keys={keys} />
        </TabsContent>
        <TabsContent value="runs" className="pt-6">
          {evaluation.runs.length === 0 ? (
            <p className="rounded-xl bg-secondary/70 px-5 py-4 text-sm text-muted-foreground">No runs yet. Each run freezes an immutable snapshot of the saved draft.</p>
          ) : (
            <ul className="surface divide-y divide-border overflow-hidden">
              {evaluation.runs.map((run) => (
                <li key={run.id}>
                  <Link to={`/runs/${run.id}`} className="flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-150 hover:bg-secondary/50 focus-visible:bg-secondary/60 focus-visible:outline-none">
                    <span className="text-sm">Started {formatTime(run.createdAt)}</span>
                    <StatusBadge status={run.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="settings" className="pt-6">
          <DeleteEvaluation evaluationId={evaluation.id} title={evaluation.title} revision={revision} />
        </TabsContent>
      </Tabs>
    </Page>
  )
}

function KeyStatus({ providers, keys }: { providers: ProviderId[]; keys: CredentialMetadata[] }) {
  return (
    <div className="surface mt-6 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <KeyRound className="size-4 text-muted-foreground" aria-hidden /> Keys this comparison needs
      </h2>
      <ul className="mt-3 space-y-1.5 text-sm">
        {providers.map((provider) => {
          const key = keys.find((k) => k.provider === provider)
          return (
            <li key={provider} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{PROVIDER_NAMES[provider]}:</span>
              {key ? <span className="text-success">saved ({key.label})</span> : <Link className="text-destructive underline" to="/settings/api-keys">missing — add a key</Link>}
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Comparing two models from the same provider needs only one key. Jurors never need keys.</p>
    </div>
  )
}

function RunDialog({ evaluationId, revision, draft, providers, keys, blockers }: { evaluationId: string; revision: number; draft: DraftInput; providers: ProviderId[]; keys: CredentialMetadata[]; blockers: string[] }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const [charges, setCharges] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intent = useRef(newIntentKey())
  const calls = draft.cases.length * draft.configurations.length

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const credentialIdsByProvider = Object.fromEntries(providers.map((provider) => [provider, keys.find((k) => k.provider === provider)?.id]))
      const result = await api<{ runId: string }>('POST', `/evaluations/${evaluationId}/runs`, {
        body: { draftRevision: revision, credentialIdsByProvider, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
        idempotencyKey: intent.current,
      })
      setOpen(false)
      navigate(`/runs/${result.runId}`)
    } catch (caught) {
      setError(describeError(caught))
      if (!(caught instanceof ApiClientError && caught.status === 0)) intent.current = newIntentKey()
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
          setConsent(false)
          setCharges(false)
          setError(null)
          intent.current = newIntentKey()
        }
      }}
    >
      <DialogTrigger render={<Button disabled={blockers.length > 0} />}>
        <Play aria-hidden /> Run comparison
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run comparison</DialogTitle>
          <DialogDescription>This freezes the saved draft into an immutable run and queues one request per case and configuration.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Planned calls</dt>
          <dd className="tabular-nums">
            {draft.cases.length} cases × {draft.configurations.length} configurations = <strong>{calls}</strong>
          </dd>
          <dt className="text-muted-foreground">Providers</dt>
          <dd>{providers.map((p) => PROVIDER_NAMES[p]).join(' and ')}</dd>
          <dt className="text-muted-foreground">Output limit</dt>
          <dd>{LIMITS.maxOutputTokens} tokens per response</dd>
        </dl>
        <div className="space-y-3 rounded-lg bg-secondary/70 p-4 text-sm ring-1 ring-foreground/5">
          <div className="flex items-start gap-2">
            <Checkbox id="consent-processing" checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
            <Label htmlFor="consent-processing" className="font-normal leading-snug">
              Send each case input, reference, and the system instructions to {providers.map((p) => PROVIDER_NAMES[p]).join(' and ')}. Scoring guides, ratings, and identities stay in Model Court.
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="consent-charges" checked={charges} onCheckedChange={(c) => setCharges(c === true)} />
            <Label htmlFor="consent-charges" className="font-normal leading-snug">
              Charge my provider accounts for these {calls} calls. A timed-out request may be charged even without a response, and a retry of it can be charged again.
            </Label>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button disabled={!consent || !charges || busy} onClick={() => void start()}>
            {busy ? 'Starting…' : `Start ${calls} calls`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteEvaluation({ evaluationId, title, revision }: { evaluationId: string; title: string; revision: number }) {
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    setBusy(true)
    try {
      await api('DELETE', `/evaluations/${evaluationId}`, { body: { confirmTitle: confirm }, revision })
      toast.success('Evaluation deleted')
      navigate('/evaluations')
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="max-w-xl space-y-4 rounded-xl border border-destructive/30 bg-card p-5 shadow-xs">
      <h2 className="text-lg font-semibold">Delete this evaluation</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Access stops immediately for you and every juror. Runs, responses, ratings, and verdicts are permanently removed within 24 hours. A provider request already in flight may still be charged. Your saved API keys are not affected. Deleting here cannot remove data the providers already received.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-title">Type the title to confirm: {title}</Label>
        <Input id="confirm-title" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="destructive" disabled={confirm !== title || busy} />}>Delete evaluation</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
