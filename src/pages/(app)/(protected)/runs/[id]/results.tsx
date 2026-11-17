import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, Gavel } from 'lucide-react'
import { toast } from 'sonner'
import { ERROR_TEXT, ErrorPanel, formatDuration, formatTime, Page, PageHeader, PageSkeleton, StatusBadge } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { verdictSchema } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { PROVIDER_NAMES } from '@/domain/registry'
import { DIMENSIONS, formatScore, RUBRIC, type CohortResult } from '@/domain/rubric'
import { codePointLength } from '@/domain/text'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { ResultsView } from '@/lib/dto'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

export default function ResultsPage() {
  const { id = '' } = useParams()
  const results = useApi<ResultsView>(`/runs/${id}/results`)
  if (results.loading && !results.data) return <Page width="wide"><PageSkeleton label="Loading results" /></Page>
  if (results.error && !results.data) {
    if (results.error.isConflict) {
      return (
        <Page>
          <Alert>
            <AlertTitle>Results are not revealed yet</AlertTitle>
            <AlertDescription>
              They appear after the judge closes review. <Link className="underline" to={`/runs/${id}`}>Back to the run</Link>
            </AlertDescription>
          </Alert>
        </Page>
      )
    }
    return <Page><ErrorPanel error={results.error} onRetry={results.reload} /></Page>
  }
  if (!results.data) return null
  return <ResultsBody data={results.data} reload={results.reload} />
}

function ResultsBody({ data, reload }: { data: ResultsView; reload: () => Promise<void> }) {
  const labels = Object.fromEntries(data.configurations.map((c) => [c.key, c.label]))
  const unblinded = data.cohorts.invited.potentiallyUnblindedCount + data.cohorts.owner.potentiallyUnblindedCount
  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link to={`/runs/${data.runId}`} className="hover:underline">
            {data.evaluationTitle} · run {formatTime(data.createdAt)}
          </Link>
        }
        title="Results"
        description={`Revealed ${formatTime(data.revealedAt)}. Scores are 0–2 means over ${data.eligibleCaseKeys.length} eligible case${data.eligibleCaseKeys.length === 1 ? '' : 's'}. No winner is declared automatically.`}
        actions={<StatusBadge status={data.status} />}
      />

      <section aria-labelledby="mapping" className="mb-12">
        <h2 id="mapping" className="mb-4 text-xl font-semibold tracking-tight">
          Revealed configurations
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {data.configurations.map((c) => (
            <Card key={c.key}>
              <CardHeader>
                <CardTitle className="text-base">{c.label}</CardTitle>
                <CardDescription>
                  {PROVIDER_NAMES[c.provider]} · <code className="font-mono text-xs">{c.modelId}</code> · {c.maxOutputTokens}-token cap
                </CardDescription>
              </CardHeader>
              <CardContent>
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground">System instructions</summary>
                  <p className="mt-3 rounded-lg bg-secondary/70 p-3 text-sm leading-relaxed whitespace-pre-wrap">{c.systemPrompt}</p>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {data.comparisonMode === 'model' ? 'Model comparison' : 'Configuration comparison — differences may come from instructions, not only the model'} · rubric {data.rubricVersion} · snapshot {data.snapshotHash.slice(0, 12)}…
        </p>
      </section>

      <section aria-labelledby="scores" className="mb-12">
        <h2 id="scores" className="mb-4 text-xl font-semibold tracking-tight">
          Scores: the jury and the judge
        </h2>
        <Tabs defaultValue={data.cohorts.invited.reviewerCount > 0 ? 'invited' : 'owner'}>
          <TabsList>
            <TabsTrigger value="invited">Jury’s findings ({data.cohorts.invited.reviewerCount} {data.cohorts.invited.reviewerCount === 1 ? 'juror' : 'jurors'})</TabsTrigger>
            <TabsTrigger value="owner">Judge’s own review, context-aware ({data.cohorts.owner.reviewerCount})</TabsTrigger>
          </TabsList>
          <TabsContent value="invited" className="pt-3">
            <CohortTable cohort={data.cohorts.invited} configurations={data.configurations} />
          </TabsContent>
          <TabsContent value="owner" className="pt-3">
            <CohortTable cohort={data.cohorts.owner} configurations={data.configurations} />
            <p className="mt-2 text-xs text-muted-foreground">The judge chose these configurations, so this review is not blind and is never combined with the jury’s findings.</p>
          </TabsContent>
        </Tabs>
      </section>

      <section aria-labelledby="coverage" className="mb-12">
        <h2 id="coverage" className="mb-4 text-xl font-semibold tracking-tight">
          Generation coverage
        </h2>
        <div className="surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Configuration</TableHead>
                <TableHead className="text-right">Succeeded / planned</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Uncertain</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead className="text-right">Median latency</TableHead>
                <TableHead className="text-right">Truncated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.configurations.map((c) => {
                const cov = data.coverage[c.key]
                return (
                  <TableRow key={c.key}>
                    <TableCell className="font-medium">{c.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {cov.succeeded}/{cov.planned} ({Math.round(cov.successRate * 100)}%)
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{cov.failed}</TableCell>
                    <TableCell className="text-right tabular-nums">{cov.uncertain}</TableCell>
                    <TableCell className="text-right tabular-nums">{cov.attempts}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatDuration(cov.medianLatencyMs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{cov.truncatedCount}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {data.excludedCaseKeys.length} of {data.plannedCaseCount} planned cases were excluded from scoring because a configuration had no accepted response. Latency includes network overhead and excludes queue wait.
        </p>
      </section>

      {(unblinded > 0 || data.disagreements.length > 0 || data.eligibleCaseKeys.length < 3) && (
        <Alert className="mb-12">
          <AlertTriangle aria-hidden />
          <AlertTitle>Read these scores with care</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-5">
              {data.eligibleCaseKeys.length < 3 && <li>Only {data.eligibleCaseKeys.length} eligible case{data.eligibleCaseKeys.length === 1 ? '' : 's'}; the evidence is small.</li>}
              {unblinded > 0 && <li>{unblinded} review session{unblinded === 1 ? '' : 's'} flagged a possible model-identity clue (potentially unblinded).</li>}
              {data.disagreements.length > 0 && <li>Ratings disagreed (by 1+ point) on {data.disagreements.length} case/configuration/dimension judgment{data.disagreements.length === 1 ? '' : 's'}; see the case evidence below.</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="evidence" className="mb-12">
        <h2 id="evidence" className="mb-4 text-xl font-semibold tracking-tight">
          Case evidence
        </h2>
        <div className="space-y-4">
          {data.cases.map((testCase, index) => (
            <details key={testCase.key} className="surface overflow-hidden" open={index === 0}>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-4 transition-colors duration-150 hover:bg-secondary/50">
                <span className="font-medium">
                  Case {index + 1}: {testCase.title}
                </span>
                {!testCase.eligible && <span className="text-xs text-warning">Excluded from scores</span>}
              </summary>
              <div className="space-y-5 border-t border-border px-5 py-5">
                <p className="text-sm"><span className="text-muted-foreground">Request:</span> {testCase.input}</p>
                <p className="text-xs text-muted-foreground">Scoring guide: {testCase.expectedBehavior}</p>
                <div className="grid gap-4 lg:grid-cols-2">
                  {testCase.responses.map((response) => (
                    <div key={response.configurationKey} className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{labels[response.configurationKey]}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatDuration(response.durationMs)} · tokens in {response.inputTokens ?? 'unavailable'} / out {response.outputTokens ?? 'unavailable'}
                          {response.truncated && ' · truncated at the output limit'}
                        </span>
                      </div>
                      {response.text ? (
                        <div className="max-h-72 overflow-y-auto rounded-lg bg-secondary/70 px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap ring-1 ring-foreground/5 ring-inset" tabIndex={0} role="region" aria-label={`${labels[response.configurationKey]} response`}>
                          {response.text}
                        </div>
                      ) : (
                        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                          No accepted response ({response.status}). {response.errorCode ? ERROR_TEXT[response.errorCode] ?? response.errorCode : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {testCase.judgments.length > 0 && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rated by</TableHead>
                          <TableHead>Configuration</TableHead>
                          {DIMENSIONS.map((d) => (
                            <TableHead key={d} className="text-right">
                              {RUBRIC[d].label}
                            </TableHead>
                          ))}
                          <TableHead>Note</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {testCase.judgments.map((j, i) => (
                          <TableRow key={i}>
                            <TableCell className="whitespace-nowrap">{j.reviewer}</TableCell>
                            <TableCell className="whitespace-nowrap">{labels[j.configurationKey]}</TableCell>
                            {DIMENSIONS.map((d) => (
                              <TableCell key={d} className="text-right tabular-nums">
                                {j[d]}
                              </TableCell>
                            ))}
                            <TableCell className="min-w-48 text-xs text-muted-foreground">
                              {j.note || '—'}
                              {j.suspectedIdentityClue && <span className="ml-1 text-warning">(identity clue flagged)</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>

      <VerdictSection data={data} reload={reload} />
    </Page>
  )
}

function CohortTable({ cohort, configurations }: { cohort: CohortResult; configurations: ResultsView['configurations'] }) {
  if (!cohort.byConfiguration) {
    return <p className="rounded-xl bg-secondary/70 px-5 py-4 text-sm text-muted-foreground">No ratings in this group.</p>
  }
  const by = cohort.byConfiguration
  const tie = cohort.highest.length > 1
  return (
    <div className="surface overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              {cohort.reviewerCount} reviewer{cohort.reviewerCount === 1 ? '' : 's'} × {cohort.caseCount} case{cohort.caseCount === 1 ? '' : 's'}
            </TableHead>
            {configurations.map((c) => (
              <TableHead key={c.key} className="text-right">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {DIMENSIONS.map((d) => (
            <TableRow key={d}>
              <TableCell>{RUBRIC[d].label}</TableCell>
              {configurations.map((c) => (
                <TableCell key={c.key} className="text-right tabular-nums">
                  {formatScore(by[c.key].dimensions[d].mean)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow className="bg-secondary/40 font-semibold hover:bg-secondary/40">
            <TableCell>Overall mean</TableCell>
            {configurations.map((c) => (
              <TableCell key={c.key} className={cn('text-right tabular-nums', cohort.highest.includes(c.key) && !tie && 'text-primary')}>
                {formatScore(by[c.key].overallMean)}
                {cohort.highest.includes(c.key) && <span className="ml-1 text-xs font-normal text-muted-foreground">{tie ? '(exact tie)' : '(highest)'}</span>}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

function VerdictSection({ data, reload }: { data: ResultsView; reload: () => Promise<void> }) {
  const isOwner = data.role === 'owner'
  const latest = data.verdicts.at(-1)
  return (
    <section aria-labelledby="verdict" className="surface relative overflow-hidden p-6 pl-7 sm:p-8 sm:pl-9">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brass" />
      <h2 id="verdict" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <Gavel className="size-5 text-brass" aria-hidden /> Verdict
      </h2>
      {latest ? (
        <div className="mt-3 space-y-1">
          <p className="font-heading text-2xl leading-snug font-semibold tracking-tight">{latest.outcome === 'selected' ? `Selected: ${data.configurations.find((c) => c.key === latest.selectedConfigurationKey)?.label}` : latest.outcome === 'tie' ? 'Tie' : 'Inconclusive'}</p>
          <p className="whitespace-pre-wrap text-sm">{latest.rationale}</p>
          {latest.limitations && <p className="whitespace-pre-wrap text-sm text-muted-foreground">Limitations: {latest.limitations}</p>}
          <p className="text-xs text-muted-foreground">
            Revision {latest.revision} · {formatTime(latest.createdAt)}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{isOwner ? 'Record your decision. It may disagree with the numbers; explain why.' : 'The judge has not recorded a verdict yet.'}</p>
      )}
      {data.verdicts.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">Earlier revisions ({data.verdicts.length - 1})</summary>
          <ol className="mt-2 space-y-2 text-sm">
            {data.verdicts.slice(0, -1).reverse().map((v) => (
              <li key={v.revision} className="rounded-lg bg-secondary/70 px-3 py-2">
                <span className="font-medium">Revision {v.revision}: {v.outcome}</span> — {v.rationale}
              </li>
            ))}
          </ol>
        </details>
      )}
      {isOwner && <VerdictForm data={data} reload={reload} revising={!!latest} />}
    </section>
  )
}

function VerdictForm({ data, reload, revising }: { data: ResultsView; reload: () => Promise<void>; revising: boolean }) {
  const [choice, setChoice] = useState<string>('')
  const [rationale, setRationale] = useState('')
  const [limitations, setLimitations] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intent = useRef(newIntentKey())
  const outcome = choice === 'tie' || choice === 'inconclusive' ? choice : choice ? 'selected' : ''
  const body = { outcome, ...(outcome === 'selected' ? { selectedConfigurationKey: choice } : {}), rationale: rationale.trim(), limitations: limitations.trim() }
  const valid = verdictSchema.safeParse(body).success

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('POST', `/runs/${data.runId}/verdicts`, { body, revision: data.revision, idempotencyKey: intent.current })
      toast.success(revising ? 'Verdict revised' : 'Verdict recorded')
      intent.current = newIntentKey()
      setChoice('')
      setRationale('')
      setLimitations('')
      await reload()
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.fields.length ? caught.fields.map((f) => f.message).join(' ') : describeError(caught))
      if (caught instanceof ApiClientError && caught.status !== 0) intent.current = newIntentKey()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="mt-6 space-y-5 border-t border-border pt-6"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h3 className="text-lg font-semibold">{revising ? 'Revise the verdict' : 'Record a verdict'}</h3>
      <RadioGroup aria-label="Decision" value={choice || null} onValueChange={(v) => setChoice(String(v))} className="grid gap-2 sm:grid-cols-2">
        {[...data.configurations.map((c) => ({ value: c.key, label: `Select ${c.label}` })), { value: 'tie', label: 'Tie' }, { value: 'inconclusive', label: 'Inconclusive' }].map((option) => (
          <Label key={option.value} htmlFor={`verdict-${option.value}`} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 font-normal transition-colors duration-150', choice === option.value ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/15' : 'border-border bg-card hover:border-input hover:bg-secondary/60')}>
            <RadioGroupItem id={`verdict-${option.value}`} value={option.value} aria-labelledby={`verdict-${option.value}-text`} />
            <span id={`verdict-${option.value}-text`}>{option.label}</span>
          </Label>
        ))}
      </RadioGroup>
      <div className="space-y-1.5">
        <Label htmlFor="verdict-rationale">Rationale</Label>
        <Textarea id="verdict-rationale" rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} aria-describedby="rationale-help" />
        <p id="rationale-help" className="text-xs text-muted-foreground tabular-nums">
          {codePointLength(rationale.trim())}/{LIMITS.verdictRationale.max} · at least {LIMITS.verdictRationale.min} characters
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="verdict-limitations">Limitations (optional)</Label>
        <Textarea id="verdict-limitations" rows={2} value={limitations} onChange={(e) => setLimitations(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!valid || busy}>
        {revising ? 'Save new revision' : 'Record verdict'}
      </Button>
    </form>
  )
}
