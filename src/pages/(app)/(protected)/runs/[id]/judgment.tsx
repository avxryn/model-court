/**
 * The Judgment divider (D-37, D-46): one printable sheet with the caption,
 * parties, the jury's findings, the judge's own review and the latest
 * judgment. Below it, on screen only, the judge enters or revises the
 * judgment with the findings in view, and downloads the certified record.
 */

import { useParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { Caption, Sheet, Stamp } from '@/components/court/CaseFile'
import { HearingFolder } from '@/components/court/HearingNav'
import { Page } from '@/components/layout/Page'
import { CertifiedRecord } from '@/components/record/CertifiedRecord'
import { FindingsTable } from '@/components/record/FindingsTable'
import { outcomeText, RecordGate, rubricName } from '@/components/record/RecordGate'
import { EarlierRevisions, VerdictForm } from '@/components/record/Verdict'
import { Button } from '@/components/ui/button'
import type { CohortResult } from '@/domain/rubric'
import type { ResultsView } from '@/lib/dto'
import { formatTime, plural } from '@/lib/format'
import { partySource } from '@/lib/parties'

export default function JudgmentPage() {
  const { id = '' } = useParams()
  return (
    <RecordGate runId={id} sealedText="A judgment can be entered and printed after the judge unseals the record.">
      {(data, reload) => <Judgment data={data} reload={reload} />}
    </RecordGate>
  )
}

function Judgment({ data, reload }: { data: ResultsView; reload: () => Promise<void> }) {
  const latest = data.verdicts.at(-1)
  const isOwner = data.role === 'owner'
  return (
    <Page>
      <HearingFolder runId={data.runId} caseId={data.evaluationId} caseTitle={data.evaluationTitle} role={data.role} status={data.status}>
        <div className="relative flex flex-wrap items-center justify-between gap-3 rounded-t-sm border-x border-t border-b border-paper-edge border-b-paper-rule bg-paper px-5 py-3 sm:px-8 print:hidden">
          <p className="text-sm text-muted-foreground">{latest ? 'The judgment as one printable page. Your browser can save it as a PDF.' : isOwner ? 'No judgment yet. Enter it below; this page prints the latest one.' : 'No judgment yet.'}</p>
          <Button variant={isOwner && !latest ? 'outline' : 'default'} onClick={() => window.print()} disabled={!latest}>
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
                <div>Rubric · {rubricName(data.rubricVersion)}</div>
                <div className="text-xs break-all text-muted-foreground">
                  Snapshot <span className="typewriter">{data.snapshotHash.slice(0, 16)}</span>
                </div>
              </>
            }
            stamp={<Stamp kind={latest ? 'entered' : 'unsealed'} />}
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
                    {c.provenance && (
                      <span className="text-muted-foreground">
                        {' '}
                        ({c.provenance.description}
                        {c.provenance.redacted ? '; redacted' : ''})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <FindingsBlock title="The jury’s findings" cohort={data.cohorts.invited} data={data} />
            {data.cohorts.owner.byConfiguration && <FindingsBlock title="The judge’s own review (context-aware, not blind)" cohort={data.cohorts.owner} data={data} />}

            <p className="text-xs text-muted-foreground">
              {data.eligibleCaseKeys.length} of {data.plannedCaseCount} questions were eligible for scoring. Means are on a 0–2 scale. {data.disagreements.length > 0 && `Ratings disagreed by a point or more on ${plural(data.disagreements.length, 'judgment')}.`}
            </p>

            <section aria-labelledby="j-judgment" className="border-t-4 border-double border-foreground pt-5">
              <h2 id="j-judgment" className="court-label">
                Judgment
              </h2>
              {latest ? (
                <>
                  <p className="mt-2 font-heading text-2xl font-bold">{outcomeText(latest, data.configurations)}</p>
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
              <EarlierRevisions verdicts={data.verdicts} />
            </section>

            {isOwner && (
              <div className="border-t border-paper-rule pt-6 print:hidden">
                <VerdictForm data={data} reload={reload} />
              </div>
            )}

            <p className="text-[0.6875rem] leading-snug text-muted-foreground">Printed from Model Court, a decision aid, not a benchmark or certification. The full certified record, with its content fingerprint, can be downloaded by the judge from this page.</p>
          </div>
          {isOwner && <CertifiedRecord runId={data.runId} className="print:hidden" />}
        </Sheet>
      </HearingFolder>
    </Page>
  )
}

function FindingsBlock({ title, cohort, data }: { title: string; cohort: CohortResult; data: ResultsView }) {
  return (
    <section className="print:break-inside-avoid">
      <h2 className="court-label">{title}</h2>
      <div className="mt-2">{cohort.byConfiguration ? <FindingsTable cohort={cohort} parties={data.configurations} rubricVersion={data.rubricVersion} caption={title} print /> : <p className="text-sm text-muted-foreground">No filed worksheets in this group.</p>}</div>
    </section>
  )
}
