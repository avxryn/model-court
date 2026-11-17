import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, KeyRound, Play } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorPanel, formatTime, Page, PageSkeleton, SaveIndicator, StatusBadge, type SaveState } from '@/components/common'
import { Caption, CaseProgress, DocketNumber, Sheet, Stamp, Term } from '@/components/court/CaseFile'
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
import { caseStep, docketNumber, recordStamp } from '@/lib/court'
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
      <Sheet>
      <Caption
        title={evaluation.title}
        parties={['Sealed party', 'Sealed party']}
        details={
          <>
            <div>
              Case no. <DocketNumber>{docketNumber(evaluation.id)}</DocketNumber>
            </div>
            <div>Seated: <span className="italic">you, as a juror</span></div>
          </>
        }
      />
      <div className="space-y-4 px-5 pb-10 sm:px-8">
      <p className="font-heading text-base leading-relaxed">You were summoned as a juror in this case. The parties stay sealed until the judge unseals the record.</p>
      <ul className="divide-y divide-paper-rule rounded-[2px] bg-white ring-1 ring-exhibit-edge">
        {evaluation.runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <span className="font-heading">Hearing · {formatTime(run.createdAt)}</span>
            <span className="flex items-center gap-3">
              <StatusBadge status={run.status} />
              <Button size="sm" variant="outline" render={<Link to={run.status === 'revealed' || run.status === 'decided' ? `/runs/${run.id}/results` : `/runs/${run.id}/review`} />} nativeButton={false}>
                {run.status === 'revealed' || run.status === 'decided' ? 'View the record' : 'Open your worksheet'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      </div>
      </Sheet>
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
  const latestRun = [...evaluation.runs].sort((a, b) => b.createdAt - a.createdAt)[0]
  const progress = caseStep(latestRun?.status)
  const stamp = recordStamp(latestRun?.status)
  const calls = draft.cases.length * draft.configurations.length

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
    ...(dirty ? ['Save the draft first — a hearing uses the saved version.'] : []),
    ...(hasErrors ? ['Fix the highlighted fields.'] : []),
    ...issues.map(describeIssue),
    ...missingProviders.map((provider) => `Add your ${PROVIDER_NAMES[provider]} key in Settings.`),
    ...(activeRun ? ['This case already has an unfinished hearing.'] : []),
    ...(catalog.data && !catalog.data.generationEnabled ? ['Live generation is disabled on this deployment.'] : []),
  ]

  return (
    <Page width="wide">
      <CaseProgress {...progress} />
      <Sheet className="rounded-t-none">
      <Caption
        backTo={{ to: '/evaluations', label: 'Back to the docket' }}
        title={evaluation.title}
        parties={draft.configurations.map((c) => c.label || 'Unnamed party')}
        details={
          <>
            <div>
              Case no. <DocketNumber>{docketNumber(evaluation.id)}</DocketNumber>
            </div>
            <div>
              {evaluation.runs.length} hearing{evaluation.runs.length === 1 ? '' : 's'}
              {latestRun && <> · latest {formatTime(latestRun.createdAt)}</>}
            </div>
            <div>Presiding: <span className="italic">you, as judge</span></div>
            {evaluation.taskDescription && <div className="text-xs leading-snug text-muted-foreground">{evaluation.taskDescription}</div>}
          </>
        }
        stamp={stamp ? <Stamp kind={stamp} /> : <Stamp kind="draft" />}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-paper-rule bg-slip/50 px-5 py-4 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <SaveIndicator state={dirty && saveState === 'idle' ? 'idle' : saveState} onRetry={() => void save()} />
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button variant="outline" disabled={!dirty || hasErrors || saveState === 'saving'} onClick={() => void save()}>
            Save draft
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground tabular-nums">
            This hearing makes <strong className="text-foreground">{calls} paid calls</strong>, billed to your keys
          </span>
          <RunDialog evaluationId={evaluation.id} revision={revision} draft={draft} providers={providers} keys={keys} blockers={blockers} />
        </div>
      </div>
      <div className="border-t border-paper-rule px-5 pt-6 pb-10 sm:px-8">
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
          <AlertTitle>A hearing is in progress</AlertTitle>
          <AlertDescription>
            Edits here only affect future hearings. <Link className="underline" to={`/runs/${activeRun.id}`}>Open the current hearing</Link>.
          </AlertDescription>
        </Alert>
      )}

      {blockers.length > 0 && (
        <div role="status" className="mb-8 rounded-[2px] border border-dashed border-slip-edge bg-slip px-5 py-4 text-sm">
          <div className="court-label">Before the hearing can start</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground/80 marker:text-stamp">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <Tabs defaultValue="cases">
        <TabsList>
          <TabsTrigger value="cases">Questions ({draft.cases.length})</TabsTrigger>
          <TabsTrigger value="configurations">Parties</TabsTrigger>
          <TabsTrigger value="runs">Hearings ({evaluation.runs.length})</TabsTrigger>
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
            <p className="rounded-[2px] bg-slip px-5 py-4 text-sm text-muted-foreground">No hearings yet. Each hearing freezes an unchangeable copy of the saved draft.</p>
          ) : (
            <ul className="divide-y divide-paper-rule overflow-hidden rounded-[2px] bg-white ring-1 ring-exhibit-edge">
              {evaluation.runs.map((run) => (
                <li key={run.id}>
                  <Link to={`/runs/${run.id}`} className="flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-150 hover:bg-slip focus-visible:bg-slip focus-visible:outline-none">
                    <span className="font-heading">Hearing · {formatTime(run.createdAt)}</span>
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
      </div>
      </Sheet>
    </Page>
  )
}

function KeyStatus({ providers, keys }: { providers: ProviderId[]; keys: CredentialMetadata[] }) {
  return (
    <div className="mt-6 rounded-[2px] bg-white p-5 ring-1 ring-exhibit-edge">
      <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
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
        <Play aria-hidden /> Start a hearing
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">Start a hearing</DialogTitle>
          <DialogDescription>This freezes the saved draft into an unchangeable hearing (a run) and sends one request per question and party, using your own provider keys.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Planned calls</dt>
          <dd className="tabular-nums">
            {draft.cases.length} questions × {draft.configurations.length} parties = <strong>{calls}</strong>
          </dd>
          <dt className="text-muted-foreground">Providers</dt>
          <dd>{providers.map((p) => PROVIDER_NAMES[p]).join(' and ')}</dd>
          <dt className="text-muted-foreground">Output limit</dt>
          <dd>{LIMITS.maxOutputTokens} tokens per response</dd>
        </dl>
        <div className="space-y-3 rounded-md bg-slip p-4 text-sm">
          <div className="flex items-start gap-2">
            <Checkbox id="consent-processing" checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
            <Label htmlFor="consent-processing" className="font-normal leading-snug">
              Send each question, its exhibit, and the system instructions to {providers.map((p) => PROVIDER_NAMES[p]).join(' and ')}. Scoring guides, ratings, and identities stay in Model Court.
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
      toast.success('Case deleted')
      navigate('/evaluations')
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="max-w-xl space-y-4 rounded-[2px] border border-destructive/30 bg-white p-5">
      <h2 className="font-heading text-lg font-bold">Delete this case</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Access stops immediately for you and every juror. Hearings, responses, ratings, and judgments are permanently removed within 24 hours. A provider request already in flight may still be charged. Your saved API keys are not affected. Deleting here cannot remove data the providers already received.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-title">Type the title to confirm: {title}</Label>
        <Input id="confirm-title" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="destructive" disabled={confirm !== title || busy} />}>Delete case</AlertDialogTrigger>
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
