/**
 * The special master (D-40), on its own judge-only divider (D-46).
 * Calibration against the jury comes first; the grader's own scores are
 * collapsed below it. Advisory: never part of the findings or the judgment.
 */

import { useRef, useState } from 'react'
import { AlertTriangle, Bot } from 'lucide-react'
import { toast } from 'sonner'
import { Term } from '@/components/court/CaseFile'
import { Fold } from '@/components/court/Fold'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ModelSelect } from '@/components/evaluations/ModelPicker'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PROVIDER_NAMES, type ProviderId } from '@/domain/registry'
import { DIMENSIONS, formatScore, rubricLines } from '@/domain/rubric'
import { api, describeError, newIntentKey } from '@/lib/api-client'
import type { CatalogView, CredentialMetadata, ResultsView, SpecialMasterView } from '@/lib/dto'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const pct = (value: number) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—')

export function SpecialMasterPanel({ results }: { results: ResultsView }) {
  const [polling, setPolling] = useState(false)
  const view = useApi<SpecialMasterView>(`/runs/${results.runId}/special-master`, { pollMs: polling ? 5_000 : undefined })
  const catalog = useApi<CatalogView>('/catalog')
  const credentials = useApi<{ items: CredentialMetadata[] }>('/credentials')
  const runs = view.data?.graderRuns ?? []
  const active = runs.some((run) => run.status === 'generating')
  if (active !== polling) setPolling(active)
  const labels = Object.fromEntries(results.configurations.map((c) => [c.key, c.label]))
  const lines = rubricLines(results.rubricVersion)
  const plannedCalls = results.eligibleCaseKeys.length * results.configurations.length

  return (
    <div className="px-5 pt-6 pb-10 sm:px-8">
      {view.data && runs.length < view.data.maxRuns && !active && (
        <StartForm runId={results.runId} catalog={catalog.data} keys={credentials.data?.items ?? []} plannedCalls={plannedCalls} partyProviders={results.configurations.flatMap((c) => (c.provider ? [c.provider] : []))} onStarted={() => void view.reload()} />
      )}
      <div className="mt-6 space-y-8">
        {[...runs].reverse().map((run) => (
          <article key={run.id} className="exhibit-panel px-5 py-4">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Bot aria-hidden className="size-4" /> {PROVIDER_NAMES[run.model.provider as ProviderId]} <span className="typewriter text-small font-normal">{run.model.modelId}</span>
              </h3>
              <span className="text-small text-muted-foreground tabular-nums">
                {run.status === 'generating' ? 'Grading… ' : run.status === 'canceled' ? 'Canceled · ' : ''}
                {run.counts.succeeded}/{run.counts.planned} graded{run.counts.failed > 0 && ` · ${run.counts.failed} failed`}
                {run.counts.uncertain > 0 && ` · ${run.counts.uncertain} uncertain`}
              </span>
            </header>
            {run.selfPreferenceRisk && (
              <p className="mt-2 flex items-start gap-1.5 text-small text-warning">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                {run.selfPreferenceRisk === 'same_model' ? 'This grader is the same model as one of the parties, so it may favor that party’s answers.' : 'This grader comes from the same provider as one of the parties, so it may favor that party’s style.'}
              </p>
            )}
            {run.status === 'generating' && (
              <Button
                className="mt-3"
                size="sm"
                variant="ghost"
                onClick={() =>
                  void api('POST', `/runs/${results.runId}/special-master/${run.id}/cancel`, { body: {} }).then(
                    () => view.reload(),
                    (caught) => toast.error(describeError(caught)),
                  )
                }
              >
                Cancel grading
              </Button>
            )}

            {run.calibration.items > 0 && (
              <div className="mt-4 space-y-3">
                <h4 className="court-label">Agreement with the jury</h4>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Line</TableHead>
                        <TableHead className="text-right">Within the jury’s range</TableHead>
                        <TableHead className="text-right">Same as the jury median</TableHead>
                        <TableHead className="text-right">Average distance (0–2)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...DIMENSIONS, 'overall' as const].map((d) => {
                        const a = run.calibration.byDimension[d]
                        return (
                          <TableRow key={d} className={cn(d === 'overall' && 'bg-slip font-semibold hover:bg-slip')}>
                            <TableCell>{d === 'overall' ? 'Overall' : lines[d].label}</TableCell>
                            <TableCell className="text-right tabular-nums">{pct(a.withinJuryRange)}</TableCell>
                            <TableCell className="text-right tabular-nums">{d === 'overall' ? '—' : pct(a.exactWithMedian)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatScore(a.meanAbsoluteDifference)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-small">
                  {run.calibration.sameTopParty === null
                    ? 'Top party: no single top party on one side, so they can’t be compared.'
                    : run.calibration.sameTopParty
                      ? `Top party: the grader agrees with the jury (${labels[run.calibration.juryTop[0]] ?? '—'}).`
                      : `Top party: the grader prefers ${labels[run.calibration.graderTop[0]] ?? '—'}; the jury preferred ${labels[run.calibration.juryTop[0]] ?? '—'}.`}
                </p>
                <p className="text-caption text-muted-foreground">{run.calibration.caveat}</p>
                {run.calibration.disagreements.length > 0 && (
                  <Fold summary={<>Where the grader falls outside the jury’s range ({run.calibration.disagreements.length})</>}>
                    <ul className="space-y-1.5 text-small">
                      {run.calibration.disagreements.map((d, i) => (
                        <li key={i} className="rounded-md bg-slip px-3 py-2">
                          <span className="font-medium">{results.cases.find((c) => c.key === d.caseKey)?.title}</span> · {labels[d.configurationKey]} · {lines[d.dimension].label}: grader {d.grader}, jury {d.juryMin === d.juryMax ? d.juryMin : `${d.juryMin}–${d.juryMax}`}
                          {d.note && <span className="block text-caption text-muted-foreground">Grader’s note: {d.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </Fold>
                )}
              </div>
            )}

            {run.counts.succeeded > 0 && (
              <Fold className="mt-4" summary={<>The special master’s own scores (advisory)</>}>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Party</TableHead>
                        {DIMENSIONS.map((d) => (
                          <TableHead key={d} className="text-right">
                            {lines[d].label}
                          </TableHead>
                        ))}
                        <TableHead className="text-right">Graded</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.configurations.map((c) => {
                        const totals = run.totals[c.key]
                        return (
                          <TableRow key={c.key}>
                            <TableCell>{c.label}</TableCell>
                            {DIMENSIONS.map((d) => (
                              <TableCell key={d} className="text-right tabular-nums">
                                {totals?.[d] === null || totals?.[d] === undefined ? '—' : formatScore(totals[d] as number)}
                              </TableCell>
                            ))}
                            <TableCell className="text-right tabular-nums">{totals?.graded ?? 0}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Fold>
            )}
            <p className="mt-3 text-caption break-all text-muted-foreground">
              Grader settings fingerprint <span className="typewriter">{run.configHash.slice(0, 16)}</span>
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}

function StartForm({ runId, catalog, keys, plannedCalls, partyProviders, onStarted }: { runId: string; catalog: CatalogView | null; keys: CredentialMetadata[]; plannedCalls: number; partyProviders: ProviderId[]; onStarted: () => void }) {
  const models = (catalog?.models ?? []).filter((m) => m.enabled)
  const [modelKey, setModelKey] = useState<string>('')
  const [consent, setConsent] = useState(false)
  const [charges, setCharges] = useState(false)
  const [busy, setBusy] = useState(false)
  const intent = useRef(newIntentKey())
  const model = models.find((m) => m.key === modelKey)
  const key = model ? keys.find((k) => k.provider === model.provider && k.status === 'active') : undefined
  const providerName = model ? PROVIDER_NAMES[model.provider] : 'the grader’s provider'
  // Say why the start button is off, one reason at a time, in the order the form is filled in.
  const blocker = busy
    ? null
    : models.length === 0
      ? 'No grader models are available right now.'
      : !model
        ? 'Choose a grader model to continue.'
        : !key
          ? `Needs your ${providerName} key.`
          : !consent || !charges
            ? 'Tick both boxes above to continue.'
            : null

  const start = async () => {
    if (!model || !key) return
    setBusy(true)
    try {
      await api('POST', `/runs/${runId}/special-master`, {
        body: { modelKey: model.key, credentialIdsByProvider: { [model.provider]: key.id }, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
        idempotencyKey: intent.current,
      })
      intent.current = newIntentKey()
      setConsent(false)
      setCharges(false)
      onStarted()
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-md border border-border bg-slip/60 px-4 py-4">
      <div className="space-y-1.5 sm:max-w-sm">
        <Label htmlFor="special-master-model">Grader model</Label>
        <ModelSelect id="special-master-model" models={models} value={modelKey} onChange={setModelKey} className="bg-exhibit" />
        {model && !key && <p className="text-caption text-destructive">Add your {providerName} key in Settings first.</p>}
        {model && partyProviders.includes(model.provider) && <p className="text-caption text-warning">This provider also made one of the parties’ answers; the grader may favor its style.</p>}
      </div>
      <div className="flex items-start gap-2 text-small">
        <Checkbox id="sm-consent" checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
        <Label htmlFor="sm-consent" className="font-normal leading-snug">
          Send each question, its exhibit, the scoring guide, and every testimony (including any imported answers) to {providerName}. The scoring guide is still never sent to the models being compared.
        </Label>
      </div>
      <div className="flex items-start gap-2 text-small">
        <Checkbox id="sm-charges" checked={charges} onCheckedChange={(c) => setCharges(c === true)} />
        <Label htmlFor="sm-charges" className="font-normal leading-snug">
          Charge my {providerName} account for {plannedCalls} calls (one per testimony). A timed-out call may be charged without a result.
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="outline" disabled={!model || !key || !consent || !charges || busy} aria-describedby={blocker ? 'sm-start-blocker' : undefined} onClick={() => void start()}>
          <Bot aria-hidden /> {busy ? 'Starting…' : `Ask the special master (${plannedCalls} calls)`}
        </Button>
        {blocker && (
          <p id="sm-start-blocker" className="text-caption text-muted-foreground">
            {blocker}
          </p>
        )}
      </div>
      <p className="text-caption text-muted-foreground">
        <Term name="findings" plain={false} /> and your judgment are not affected.
      </p>
    </div>
  )
}
