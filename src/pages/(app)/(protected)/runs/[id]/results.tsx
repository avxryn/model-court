import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, Download } from 'lucide-react'
import { toast } from 'sonner'
import { ERROR_TEXT, ErrorPanel, formatDuration, formatTime, Page, PageSkeleton, StatusBadge } from '@/components/common'
import { Caption, CaseProgress, Sheet, SheetSection, Stamp, Term } from '@/components/court/CaseFile'
import { FindingsChart } from '@/components/court/FindingsChart'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { verdictSchema } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { partySource } from '@/lib/parties'
import { DIMENSIONS, formatScore, rubricLines, RUBRICS, type CohortResult } from '@/domain/rubric'
import { codePointLength } from '@/domain/text'
import { api, ApiClientError, apiDownload, describeError, newIntentKey, saveBlob } from '@/lib/api-client'
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
            <AlertTitle>The record is still sealed</AlertTitle>
            <AlertDescription>
              It opens after the judge unseals it. <Link className="underline" to={`/runs/${id}`}>Back to the hearing</Link>
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
  const decided = data.status === 'decided'
  const RUBRIC = rubricLines(data.rubricVersion)
  const rubricName = (RUBRICS as Record<string, { name: string }>)[data.rubricVersion]?.name ?? data.rubricVersion
  return (
    <Page width="wide">
      <CaseProgress step="judgment" complete={decided} />
      <Sheet className="rounded-t-none">
      <Caption
        backTo={{ to: `/runs/${data.runId}`, label: 'Back to the hearing' }}
        title={data.evaluationTitle}
        parties={data.configurations.map((c) => c.label)}
        details={
          <>
            <div>Hearing · {formatTime(data.createdAt)}</div>
            <div>Unsealed · {formatTime(data.revealedAt)}</div>
            <div>Rubric · {rubricName}</div>
            <div className="text-xs leading-snug text-muted-foreground">
              Scores are 0–2 means over {data.eligibleCaseKeys.length} eligible question{data.eligibleCaseKeys.length === 1 ? '' : 's'}. No winner is declared automatically.
            </div>
            <div className="mt-1 font-sans">
              <StatusBadge status={data.status} />
            </div>
          </>
        }
        stamp={<Stamp kind={decided ? 'entered' : 'unsealed'} />}
      />

      <SheetSection id="mapping" label={<Term name="parties" />}>
        <div className="grid gap-4 md:grid-cols-2">
          {data.configurations.map((c) => (
            <div key={c.key} className="rounded-[2px] bg-white px-5 py-4 ring-1 ring-exhibit-edge">
              <h3 className="font-heading text-lg font-bold">{c.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {partySource(c)}
                {c.maxOutputTokens && <> · {c.maxOutputTokens}-token cap</>}
              </p>
              {c.provenance ? (
                <p className="mt-3 rounded-[2px] bg-slip p-3 font-heading text-sm leading-relaxed">
                  {c.provenance.description}
                  {c.provenance.collectedOn && <span className="text-muted-foreground"> · collected {c.provenance.collectedOn}</span>}
                  {c.provenance.redacted && <span className="text-muted-foreground"> · redacted before review</span>}
                </p>
              ) : (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground">System instructions</summary>
                  <p className="mt-3 rounded-[2px] bg-slip p-3 font-heading text-sm leading-relaxed whitespace-pre-wrap">{c.systemPrompt}</p>
                </details>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {data.comparisonMode === 'model' ? 'Model comparison' : 'Configuration comparison — differences may come from instructions, not only the model'} · rubric {data.rubricVersion} · snapshot {data.snapshotHash.slice(0, 12)}…
        </p>
      </SheetSection>

      <SheetSection id="scores" label={<>Findings{' '}<span className="inline-block font-sans text-xs font-normal tracking-normal text-muted-foreground normal-case">(scores from the jury and from the judge)</span></>}>
        <Tabs defaultValue={data.cohorts.invited.reviewerCount > 0 ? 'invited' : 'owner'}>
          <TabsList>
            <TabsTrigger value="invited">Jury’s findings ({data.cohorts.invited.reviewerCount} {data.cohorts.invited.reviewerCount === 1 ? 'juror' : 'jurors'})</TabsTrigger>
            <TabsTrigger value="owner">Judge’s own review, context-aware ({data.cohorts.owner.reviewerCount})</TabsTrigger>
          </TabsList>
          <TabsContent value="invited" className="pt-3">
            <CohortTable cohort={data.cohorts.invited} configurations={data.configurations} rubricVersion={data.rubricVersion} />
          </TabsContent>
          <TabsContent value="owner" className="pt-3">
            <CohortTable cohort={data.cohorts.owner} configurations={data.configurations} rubricVersion={data.rubricVersion} />
            <p className="mt-2 text-xs text-muted-foreground">The judge chose these parties, so this review is not blind and is never combined with the jury’s findings.</p>
          </TabsContent>
        </Tabs>
      </SheetSection>

      {data.byLanguage.length > 0 && (
        <SheetSection id="by-language" label={<>Findings by language{' '}<span className="inline-block font-sans text-xs font-normal tracking-normal text-muted-foreground normal-case">(overall means; jury first, judge in brackets)</span></>}>
          <div className="overflow-x-auto rounded-[2px] bg-white ring-1 ring-exhibit-edge">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Language</TableHead>
                  <TableHead className="text-right">Questions</TableHead>
                  {data.configurations.map((c) => (
                    <TableHead key={c.key} className="text-right">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byLanguage.map((group) => (
                  <TableRow key={group.language ?? 'untagged'}>
                    <TableCell className="font-medium">{group.language ?? <span className="text-muted-foreground italic">Untagged</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.caseKeys.length}</TableCell>
                    {data.configurations.map((c) => (
                      <TableCell key={c.key} className="text-right tabular-nums">
                        {group.invited.byConfiguration ? formatScore(group.invited.byConfiguration[c.key].overallMean) : '—'}
                        {group.owner.byConfiguration && <span className="ml-1 text-xs text-muted-foreground">({formatScore(group.owner.byConfiguration[c.key].overallMean)})</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Each language is scored on its own questions only. With few questions per language, treat differences as exploratory.</p>
        </SheetSection>
      )}

      <SheetSection id="coverage" label={<>Testimony taken{' '}<span className="inline-block font-sans text-xs font-normal tracking-normal text-muted-foreground normal-case">(generation coverage)</span></>}>
        <div className="overflow-x-auto rounded-[2px] bg-white ring-1 ring-exhibit-edge">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Party</TableHead>
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
          {data.excludedCaseKeys.length} of {data.plannedCaseCount} planned questions were excluded from scoring because a party had no accepted testimony. Latency includes network overhead and excludes queue wait.
        </p>
      </SheetSection>

      {(unblinded > 0 || data.disagreements.length > 0 || data.eligibleCaseKeys.length < 3) && (
        <div className="border-t border-paper-rule px-5 py-6 sm:px-8">
        <Alert className="bg-slip">
          <AlertTriangle aria-hidden />
          <AlertTitle>Read these scores with care</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-5">
              {data.eligibleCaseKeys.length < 3 && <li>Only {data.eligibleCaseKeys.length} eligible question{data.eligibleCaseKeys.length === 1 ? '' : 's'}; the evidence is small.</li>}
              {unblinded > 0 && <li>{unblinded} worksheet{unblinded === 1 ? '' : 's'} flagged a possible clue to a party’s identity (potentially unblinded).</li>}
              {data.disagreements.length > 0 && <li>Ratings disagreed (by 1+ point) on {data.disagreements.length} question/party/line judgment{data.disagreements.length === 1 ? '' : 's'}; see the record below.</li>}
            </ul>
          </AlertDescription>
        </Alert>
        </div>
      )}

      <SheetSection id="evidence" label={<Term name="record" />}>
        <div className="space-y-4">
          {data.cases.map((testCase, index) => (
            <details key={testCase.key} className="overflow-hidden rounded-[2px] bg-white ring-1 ring-exhibit-edge" open={index === 0}>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-4 transition-colors duration-150 hover:bg-slip">
                <span className="font-heading font-bold">
                  Q{index + 1}: {testCase.title}
                </span>
                {!testCase.eligible && <span className="text-xs text-warning">Excluded from scores</span>}
              </summary>
              <div className="space-y-5 border-t border-paper-rule px-5 py-5">
                <p className="font-heading"><span className="court-label mr-2">Question presented</span>{testCase.input}</p>
                <p className="text-xs text-muted-foreground">Jury instructions: {testCase.expectedBehavior}</p>
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
                        <div className="max-h-72 overflow-y-auto rounded-[2px] bg-paper px-4 py-3 font-heading text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap ring-1 ring-paper-rule outline-none ring-inset focus-visible:ring-3 focus-visible:ring-ring/50" tabIndex={0} role="region" aria-label={`${labels[response.configurationKey]} testimony`}>
                          {response.text}
                        </div>
                      ) : (
                        <p className="rounded-[2px] border border-dashed border-paper-edge p-3 text-sm text-muted-foreground">
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
                          <TableHead>Party</TableHead>
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
      </SheetSection>

      <VerdictSection data={data} reload={reload} />
      {data.role === 'owner' && <CertifiedRecord runId={data.runId} />}
      </Sheet>
    </Page>
  )
}

function CohortTable({ cohort, configurations, rubricVersion }: { cohort: CohortResult; configurations: ResultsView['configurations']; rubricVersion: string }) {
  const RUBRIC = rubricLines(rubricVersion)
  if (!cohort.byConfiguration) {
    return <p className="rounded-[2px] bg-slip px-5 py-4 text-sm text-muted-foreground">No ratings in this group.</p>
  }
  const by = cohort.byConfiguration
  const tie = cohort.highest.length > 1
  return (
    <>
    <FindingsChart cohort={cohort} parties={configurations} rubricVersion={rubricVersion} />
    <div className="overflow-x-auto rounded-[2px] bg-white ring-1 ring-exhibit-edge">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              {cohort.reviewerCount} rater{cohort.reviewerCount === 1 ? '' : 's'} × {cohort.caseCount} question{cohort.caseCount === 1 ? '' : 's'}
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
          <TableRow className="bg-slip font-semibold hover:bg-slip">
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
    </>
  )
}

/** Owner-only download of the certified record (D-28, D-29). Each export is logged in the audit trail. */
function CertifiedRecord({ runId }: { runId: string }) {
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null)
  const [hash, setHash] = useState<string | null>(null)
  const download = async (format: 'json' | 'csv') => {
    setBusy(format)
    try {
      if (format === 'json') {
        const record = await api<{ certification: { contentSha256: string } }>('GET', `/runs/${runId}/export?format=json`)
        setHash(record.certification.contentSha256)
        saveBlob(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }), `model-court-record-${runId}.json`)
      } else {
        const { blob, filename } = await apiDownload(`/runs/${runId}/export?format=csv`)
        saveBlob(blob, filename ?? `model-court-record-${runId}.csv`)
      }
      toast.success('Certified record downloaded')
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(null)
    }
  }
  return (
    <SheetSection id="certified-record" label={<Term name="certified" />}>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        A copy of this hearing’s record for your files: questions, testimony, every rating, findings, failures, and judgments. It never includes API keys, invitation links, or account ids. Only you, the judge, can download it, and each download is logged.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void download('json')}>
          <Download aria-hidden /> {busy === 'json' ? 'Preparing…' : 'Download record (JSON)'}
        </Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => void download('csv')}>
          <Download aria-hidden /> {busy === 'csv' ? 'Preparing…' : 'Download ratings (CSV)'}
        </Button>
      </div>
      {hash && (
        <p className="mt-3 text-xs break-all text-muted-foreground">
          Content fingerprint (SHA-256): <span className="typewriter text-foreground">{hash}</span>. Two copies of the same record have the same fingerprint. It is not a signature.
        </p>
      )}
    </SheetSection>
  )
}

function VerdictSection({ data, reload }: { data: ResultsView; reload: () => Promise<void> }) {
  const isOwner = data.role === 'owner'
  const latest = data.verdicts.at(-1)
  return (
    <section aria-labelledby="verdict" className="relative border-t-4 border-double border-foreground px-5 pt-6 pb-10 sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="verdict" className="court-label">
          <Term name="judgment" />
        </h2>
        {latest && (
          <Link to={`/runs/${data.runId}/judgment`} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Printable judgment
          </Link>
        )}
      </div>
      {latest ? (
        <div className="mt-3 space-y-2">
          <p className="font-heading text-2xl leading-snug font-bold">{latest.outcome === 'selected' ? `Selected: ${data.configurations.find((c) => c.key === latest.selectedConfigurationKey)?.label}` : latest.outcome === 'tie' ? 'Tie' : 'Inconclusive'}</p>
          <p className="max-w-3xl font-heading leading-relaxed whitespace-pre-wrap">{latest.rationale}</p>
          {latest.limitations && <p className="max-w-3xl text-sm whitespace-pre-wrap text-muted-foreground">Limitations: {latest.limitations}</p>}
          <div className="flex flex-wrap items-end justify-between gap-6 pt-4">
            <div className="min-w-56">
              <div className="border-b border-foreground pb-1 font-heading text-xl italic">The judge</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Entered {formatTime(latest.createdAt)} · revision {latest.revision}
              </div>
            </div>
            <Stamp kind="entered" detail={new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(latest.createdAt).toUpperCase()} />
          </div>
        </div>
      ) : (
        <p className="mt-2 font-heading text-base text-muted-foreground">{isOwner ? 'Enter your judgment. It may disagree with the numbers; say why.' : 'The judge has not entered judgment yet.'}</p>
      )}
      {data.verdicts.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">Earlier revisions ({data.verdicts.length - 1})</summary>
          <ol className="mt-2 space-y-2 text-sm">
            {data.verdicts.slice(0, -1).reverse().map((v) => (
              <li key={v.revision} className="rounded-[2px] bg-slip px-3 py-2">
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
      toast.success(revising ? 'Judgment revised' : 'Judgment entered')
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
      className="mt-8 space-y-5 border-t border-paper-rule pt-6"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h3 className="font-heading text-lg font-bold">{revising ? 'Revise the judgment' : 'Enter judgment'}</h3>
      <RadioGroup aria-label="Decision" value={choice || null} onValueChange={(v) => setChoice(String(v))} className="grid gap-2 sm:grid-cols-2">
        {[...data.configurations.map((c) => ({ value: c.key, label: `Select ${c.label}` })), { value: 'tie', label: 'Tie' }, { value: 'inconclusive', label: 'Inconclusive' }].map((option) => (
          <Label key={option.value} htmlFor={`verdict-${option.value}`} className={cn('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 font-heading font-normal transition-colors duration-150', choice === option.value ? 'border-foreground bg-slip' : 'border-paper-edge bg-white hover:bg-slip/60')}>
            <RadioGroupItem id={`verdict-${option.value}`} value={option.value} aria-labelledby={`verdict-${option.value}-text`} />
            <span id={`verdict-${option.value}-text`}>{option.label}</span>
          </Label>
        ))}
      </RadioGroup>
      <div className="space-y-1.5">
        <Label htmlFor="verdict-rationale">Reasons</Label>
        <Textarea id="verdict-rationale" className="bg-white font-heading" rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} aria-describedby="rationale-help" />
        <p id="rationale-help" className="text-xs text-muted-foreground tabular-nums">
          {codePointLength(rationale.trim())}/{LIMITS.verdictRationale.max} · at least {LIMITS.verdictRationale.min} characters
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="verdict-limitations">Limitations (optional)</Label>
        <Textarea id="verdict-limitations" className="bg-white font-heading" rows={2} value={limitations} onChange={(e) => setLimitations(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!valid || busy}>
        {revising ? 'Enter revised judgment' : 'Enter judgment'}
      </Button>
    </form>
  )
}
