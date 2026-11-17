/**
 * Printable judgment (phase 3, D-37): one sheet with the caption, parties,
 * the jury's findings, the judge's own review, and the latest judgment.
 * Uses the same results projection as the record page; nothing new is fetched.
 */

import { Link, useParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { ErrorPanel, formatTime, Page, PageSkeleton } from '@/components/common'
import { Caption, Sheet, Stamp } from '@/components/court/CaseFile'
import { HearingNav } from '@/components/court/HearingNav'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { partySource } from '@/lib/parties'
import { DIMENSIONS, formatScore, rubricLines, RUBRICS, type CohortResult } from '@/domain/rubric'
import type { ResultsView } from '@/lib/dto'
import { useApi } from '@/lib/use-api'

export default function JudgmentPage() {
  const { id = '' } = useParams()
  const results = useApi<ResultsView>(`/runs/${id}/results`)
  if (results.loading && !results.data) return <Page><PageSkeleton label="Loading the judgment" /></Page>
  if (results.error && !results.data) {
    if (results.error.isConflict) {
      return (
        <Page>
          <Alert>
            <AlertTitle>The record is still sealed</AlertTitle>
            <AlertDescription>
              A judgment can be printed after the judge unseals the record. <Link className="underline" to={`/runs/${id}`}>Back to the hearing</Link>
            </AlertDescription>
          </Alert>
        </Page>
      )
    }
    return <Page><ErrorPanel error={results.error} onRetry={results.reload} /></Page>
  }
  if (!results.data) return null
  return <PrintableJudgment data={results.data} />
}

function PrintableJudgment({ data }: { data: ResultsView }) {
  const latest = data.verdicts.at(-1)
  const lines = rubricLines(data.rubricVersion)
  const rubricName = (RUBRICS as Record<string, { name: string }>)[data.rubricVersion]?.name ?? data.rubricVersion
  const labelOf = (key: string | null) => data.configurations.find((c) => c.key === key)?.label ?? '—'
  const outcome = latest ? (latest.outcome === 'selected' ? `Selected: ${labelOf(latest.selectedConfigurationKey)}` : latest.outcome === 'tie' ? 'Tie' : 'Inconclusive') : null

  return (
    <Page>
      <HearingNav runId={data.runId} caseId={data.evaluationId} caseTitle={data.evaluationTitle} role={data.role} status={data.status} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-tr-sm border-x border-t border-paper-edge bg-slip/70 px-5 py-3 sm:px-8 print:hidden">
        <p className="text-sm text-muted-foreground">{latest ? 'The judgment as one printable page. Your browser can save it as a PDF.' : 'No judgment yet. Enter it on the Record tab; this page prints the latest one.'}</p>
        <Button onClick={() => window.print()} disabled={!latest}>
          <Printer aria-hidden /> Print or save as PDF
        </Button>
      </div>
      <Sheet as="article" aria-label="Judgment" className="rounded-t-none print:rounded-sm print:shadow-none print:ring-0">
        <Caption
          title={data.evaluationTitle}
          parties={data.configurations.map((c) => c.label)}
          details={
            <>
              <div>Hearing · {formatTime(data.createdAt)}</div>
              <div>Unsealed · {formatTime(data.revealedAt)}</div>
              <div>Rubric · {rubricName}</div>
              <div className="text-xs break-all text-muted-foreground">
                Snapshot <span className="typewriter">{data.snapshotHash.slice(0, 16)}</span>
              </div>
            </>
          }
          stamp={latest ? <Stamp kind="entered" /> : <Stamp kind="unsealed" />}
        />

        <div className="space-y-6 px-5 pb-10 sm:px-8">
          <section aria-labelledby="j-parties">
            <h2 id="j-parties" className="court-label">
              The parties
            </h2>
            <ul className="mt-2 space-y-1 font-heading text-sm">
              {data.configurations.map((c) => (
                <li key={c.key}>
                  <span className="font-bold">{c.label}</span> — {partySource(c)}
                  {c.provenance && <span className="text-muted-foreground"> ({c.provenance.description}{c.provenance.redacted ? '; redacted' : ''})</span>}
                </li>
              ))}
            </ul>
          </section>

          <FindingsBlock title="The jury’s findings" cohort={data.cohorts.invited} data={data} lines={lines} />
          {data.cohorts.owner.byConfiguration && <FindingsBlock title="The judge’s own review (context-aware, not blind)" cohort={data.cohorts.owner} data={data} lines={lines} />}

          <p className="text-xs text-muted-foreground">
            {data.eligibleCaseKeys.length} of {data.plannedCaseCount} questions were eligible for scoring. Means are on a 0–2 scale. {data.disagreements.length > 0 && `Ratings disagreed by a point or more on ${data.disagreements.length} judgment${data.disagreements.length === 1 ? '' : 's'}.`}
          </p>

          <section aria-labelledby="j-judgment" className="border-t-4 border-double border-foreground pt-5">
            <h2 id="j-judgment" className="court-label">
              Judgment
            </h2>
            {latest ? (
              <>
                <p className="mt-2 font-heading text-2xl font-bold">{outcome}</p>
                <p className="mt-2 font-heading leading-relaxed whitespace-pre-wrap">{latest.rationale}</p>
                {latest.limitations && <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">Limitations: {latest.limitations}</p>}
                <div className="mt-10 grid gap-8 sm:grid-cols-2 print:break-inside-avoid">
                  <div>
                    <div className="h-10 border-b border-foreground" />
                    <div className="mt-1 text-xs text-muted-foreground">Signature of the judge</div>
                  </div>
                  <div>
                    <div className="flex h-10 items-end border-b border-foreground pb-1 font-heading">{new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(latest.createdAt)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Date entered (revision {latest.revision})</div>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-2 font-heading text-muted-foreground">Judgment has not been entered.</p>
            )}
          </section>

          <p className="text-[0.6875rem] leading-snug text-muted-foreground">
            Printed from Model Court, a decision aid, not a benchmark or certification. The full certified record, with its content fingerprint, can be downloaded by the judge from the record page.
          </p>
        </div>
      </Sheet>
    </Page>
  )
}

function FindingsBlock({ title, cohort, data, lines }: { title: string; cohort: CohortResult; data: ResultsView; lines: ReturnType<typeof rubricLines> }) {
  const by = cohort.byConfiguration
  return (
    <section className="print:break-inside-avoid">
      <h2 className="court-label">{title}</h2>
      {by ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-foreground text-left">
                <th className="py-1.5 pr-3 font-medium">
                  {cohort.reviewerCount} rater{cohort.reviewerCount === 1 ? '' : 's'} × {cohort.caseCount} question{cohort.caseCount === 1 ? '' : 's'}
                </th>
                {data.configurations.map((c) => (
                  <th key={c.key} className="py-1.5 pl-3 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DIMENSIONS.map((d) => (
                <tr key={d} className="border-b border-paper-rule">
                  <td className="py-1.5 pr-3">{lines[d].label}</td>
                  {data.configurations.map((c) => (
                    <td key={c.key} className="py-1.5 pl-3 text-right tabular-nums">
                      {formatScore(by[c.key].dimensions[d].mean)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-1.5 pr-3">Overall mean</td>
                {data.configurations.map((c) => (
                  <td key={c.key} className="py-1.5 pl-3 text-right tabular-nums">
                    {formatScore(by[c.key].overallMean)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No filed worksheets in this group.</p>
      )}
    </section>
  )
}
