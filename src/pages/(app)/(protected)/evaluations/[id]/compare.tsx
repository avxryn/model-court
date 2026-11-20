/**
 * Compare hearings of one case (spec 02 §3.3, D-70): each hearing on its own, side by side,
 * never pooled; an anchor party as the only bridge; the limits in plain words. Judge only.
 */

import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { Caption, DocketNumber, Sheet, SheetSection } from '@/components/court/CaseFile'
import { Note, Panel, Plain, SlipList } from '@/components/court/Paper'
import { ErrorPanel } from '@/components/feedback/ErrorPanel'
import { PageSkeleton } from '@/components/feedback/PageSkeleton'
import { Breadcrumbs, Page } from '@/components/layout/Page'
import { formatPoints, recordTally } from '@/components/record/headline'
import { rubricName } from '@/components/record/RecordGate'
import { setupRows } from '@/components/record/setup-summary'
import { SetupTable } from '@/components/record/SetupSection'
import { useShellFocus } from '@/components/shell/ShellContext'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import type { ProviderId } from '@/domain/registry'
import { docketNumber } from '@/lib/court'
import type { ComparisonView, EvaluationView, OwnerEvaluationView, ResultsView } from '@/lib/dto'
import { formatTime, plural } from '@/lib/format'
import { partySource } from '@/lib/parties'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const MAX = 5

export default function ComparePage() {
  const { id = '' } = useParams()
  const evaluation = useApi<EvaluationView>(`/evaluations/${id}`)
  if (evaluation.loading && !evaluation.data) return <Page width="wide"><PageSkeleton variant="sheet" label="Loading the case" /></Page>
  if (evaluation.error && !evaluation.data) return <Page><ErrorPanel error={evaluation.error} onRetry={evaluation.reload} /></Page>
  if (!evaluation.data || evaluation.data.role !== 'owner') return <Page><Note>Only the judge of this case can compare its hearings.</Note></Page>
  return <Compare evaluation={evaluation.data as OwnerEvaluationView} />
}

type Run = OwnerEvaluationView['runs'][number]
const unsealed = (run: Run) => run.status === 'revealed' || run.status === 'decided'

/** Default: the latest two hearings of the newest version that has two unsealed; else the latest two unsealed. */
export function defaultSelection(runs: readonly Run[]): string[] {
  const open = runs.filter(unsealed).sort((a, b) => b.createdAt - a.createdAt)
  const versions = [...new Set(open.map((run) => run.scenarioVersion))]
  for (const version of versions) {
    const same = open.filter((run) => run.scenarioVersion === version)
    if (same.length >= 2) return same.slice(0, 2).map((run) => run.id)
  }
  return open.slice(0, 2).map((run) => run.id)
}

function Compare({ evaluation }: { evaluation: OwnerEvaluationView }) {
  useShellFocus(evaluation.id)
  const [params, setParams] = useSearchParams()
  const open = evaluation.runs.filter(unsealed).sort((a, b) => a.createdAt - b.createdAt)
  const selected = useMemo(() => {
    const asked = (params.get('runIds') ?? '').split(',').filter((runId) => open.some((run) => run.id === runId))
    return asked.length ? asked : defaultSelection(evaluation.runs)
  }, [params, evaluation.runs])
  const toggle = (runId: string, on: boolean) => {
    const next = on ? [...selected, runId] : selected.filter((item) => item !== runId)
    setParams((current) => {
      const copy = new URLSearchParams(current)
      copy.set('runIds', next.join(','))
      return copy
    }, { replace: true })
  }
  const ready = selected.length >= 2
  const comparison = useApi<ComparisonView>(ready ? `/evaluations/${evaluation.id}/comparison?runIds=${selected.join(',')}` : null)

  return (
    <Page width="wide">
      <Breadcrumbs items={[{ label: 'Your cases', to: '/evaluations' }, { label: evaluation.title, to: `/evaluations/${evaluation.id}` }, { label: 'Compare hearings' }]} />
      <Sheet>
        <Caption
          title="Compare hearings"
          details={
            <>
              <div>
                Case no. <DocketNumber>{docketNumber(evaluation.id)}</DocketNumber>
              </div>
              <div>{evaluation.title}</div>
              <div className="text-caption leading-snug text-muted-foreground">Each hearing is scored on its own. Nothing here adds scores from different hearings together.</div>
            </>
          }
        />
        <SheetSection id="pick" label={<>Hearings <Plain>{`choose 2 to ${MAX}`}</Plain></>}>
          {open.length < 2 ? (
            <Note>Comparing needs two unsealed hearings. Unseal another hearing, or re-hear this case with different parties.</Note>
          ) : (
            <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="sr-only">Hearings to compare</legend>
              {open.map((run) => {
                const checked = selected.includes(run.id)
                return (
                  <Field key={run.id} orientation="horizontal" className="items-start rounded-md border border-border px-3 py-2.5">
                    <Checkbox id={`pick-${run.id}`} checked={checked} disabled={!checked && selected.length >= MAX} onCheckedChange={(c) => toggle(run.id, c === true)} />
                    <FieldLabel htmlFor={`pick-${run.id}`} className="block font-normal">
                      <span className="font-medium">Hearing {run.number}</span> · questions v{run.scenarioVersion}
                      <span className="block text-caption text-muted-foreground">{formatTime(run.createdAt)}</span>
                    </FieldLabel>
                  </Field>
                )
              })}
            </fieldset>
          )}
        </SheetSection>
        {ready && comparison.error && !comparison.data && (
          <div className="px-5 pb-6 sm:px-8">
            <ErrorPanel error={comparison.error} onRetry={comparison.reload} />
          </div>
        )}
        {ready && comparison.loading && !comparison.data && (
          <div className="px-5 pb-6 sm:px-8">
            <Note>Lining up the hearings…</Note>
          </div>
        )}
        {ready && comparison.data && <ComparisonBody data={comparison.data} runs={evaluation.runs} />}
      </Sheet>
    </Page>
  )
}

const CAVEAT_TEXT: Record<ComparisonView['caveats'][number], string> = {
  different_juries: 'Different people judged each hearing, so the same answer could score differently.',
  few_raters: 'At least one hearing has fewer than three raters; one person’s view moves its numbers a lot.',
  questions_partial: 'The hearings did not ask exactly the same questions; only the questions they share are used.',
  rubric_differs: 'The rubrics differ, so the points are on different scales.',
  template_differs: 'The question format differs (a conversation so far in one hearing, not the other).',
  rater_source_differs: 'One hearing was scored by a jury and another by the judge alone.',
  adapter_changed: 'The request format changed between hearings (an app upgrade), even where the model and instructions are the same.',
  no_anchor: 'No setup was heard in every hearing, so scores across them are not on a common footing.',
  repeat_jurors: 'Some jurors had already seen an unsealed record sharing a party with a later hearing; their findings there may not be blind.',
}

function Mark({ ok }: { ok: boolean }) {
  return ok ? <Check aria-label="Yes" className="size-4 shrink-0 text-primary" /> : <X aria-label="No" className="size-4 shrink-0 text-stamp" />
}

/** Exported for render tests and screenshots; `records` replaces the per-hearing record fetch there. */
export function ComparisonBody({ data, runs, records }: { data: ComparisonView; runs: readonly Run[]; records?: Record<string, ResultsView> }) {
  const numberOf = (runId: string) => runs.find((run) => run.id === runId)?.number ?? '?'
  const name = (runId: string) => `hearing ${numberOf(runId)}`
  const total = data.questions.length
  const checklist: Array<{ ok: boolean; text: string }> = [
    { ok: data.comparable.sameQuestions, text: data.comparable.sameQuestions ? 'Same questions' : `${data.commonQuestionCount} of ${total} questions in common; only those are used` },
    { ok: data.comparable.sameRubric, text: data.comparable.sameRubric ? `Same rubric (${rubricName(data.hearings[0].rubricVersion)})` : 'Different rubrics' },
    { ok: data.comparable.sameTemplate, text: data.comparable.sameTemplate ? 'Same question format' : 'Different question formats' },
    { ok: data.comparable.sameRaterSource, text: data.comparable.sameRaterSource ? (data.hearings[0].raterSource === 'jury' ? 'Each scored by a jury' : 'Each scored by the judge alone') : 'Some by a jury, some by the judge alone' },
    ...data.jurorOverlap.map((overlap) => ({
      ok: true,
      text: `${plural(overlap.shared, 'juror')} of ${name(overlap.runIds[0])} also sat on ${name(overlap.runIds[1])}${overlap.guests > 0 ? ` (unknown for ${plural(overlap.guests, 'guest juror')})` : ''}`,
    })),
  ]
  return (
    <>
      <SheetSection id="comparable" label="Can these be compared?">
        <ul className="space-y-1.5 text-small">
          {checklist.map((item) => (
            <li key={item.text} className="flex items-start gap-2">
              <Mark ok={item.ok} />
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </SheetSection>
      <SheetSection id="each" label={<>Each hearing on its own <Plain>its own headline, unchanged</Plain></>}>
        <div className={cn('grid gap-4', data.hearings.length >= 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2')}>
          {data.hearings.map((hearing) => (
            <HearingColumn key={hearing.runId} runId={hearing.runId} number={numberOf(hearing.runId)} hearing={hearing} record={records?.[hearing.runId]} />
          ))}
        </div>
      </SheetSection>
      <SheetSection id="anchor" label={<>Through the anchor <Plain>a setup heard in every hearing</Plain></>}>
        <AnchorSection data={data} name={name} />
      </SheetSection>
      <SheetSection id="setup" label={<>Speed and cost <Plain>per hearing, estimates</Plain></>}>
        <div className="space-y-6">
          {data.hearings.map((hearing) => {
            const rows = setupRows({ configurations: hearing.parties.map((p) => ({ key: p.key, label: p.label, provider: p.provider as ProviderId | null, modelId: p.modelId, ...(p.source === 'imported' ? { source: 'imported' as const } : {}) })), setupMetrics: data.setupMetrics[hearing.runId] }, partySource)
            return (
              <div key={hearing.runId}>
                <h3 className="mb-2 text-small font-semibold">Hearing {numberOf(hearing.runId)}</h3>
                <SetupTable rows={rows} caption={`Estimated cost and speed for hearing ${numberOf(hearing.runId)}`} />
              </div>
            )
          })}
        </div>
      </SheetSection>
      <SheetSection id="limits" label="What this does not tell you">
        <SlipList
          items={[
            ...data.caveats.map((caveat) => CAVEAT_TEXT[caveat]),
            'Comparing through an anchor is indirect: it shows how each party did against the same setup in its own hearing, not against each other.',
            'These are small numbers from a few questions and a few people. This is not a benchmark.',
          ]}
        />
      </SheetSection>
    </>
  )
}

function HearingColumn({ runId, number, hearing, record }: { runId: string; number: number | string; hearing: ComparisonView['hearings'][number]; record?: ResultsView }) {
  const results = useApi<ResultsView>(record ? null : `/runs/${runId}/results`)
  const data = record ?? results.data
  const tally = data ? recordTally(data) : null
  return (
    <Panel className="px-4 py-3.5">
      <h3 className="font-heading text-base">
        <Link to={`/runs/${runId}/results`} className="underline-offset-4 hover:underline">
          Hearing {number}
        </Link>
        <span className="ml-2 font-sans text-caption text-muted-foreground">questions v{hearing.scenarioVersion}</span>
      </h3>
      <p className="mt-0.5 text-caption text-muted-foreground">
        {hearing.raterSource === 'jury' ? `${plural(hearing.raterCount, 'juror')}${hearing.guestRaterCount ? `, ${hearing.guestRaterCount} without an account` : ''}` : 'The judge alone'}
        {hearing.repeatJurorCount > 0 && ` · ${plural(hearing.repeatJurorCount, 'juror')} may not be blind`}
      </p>
      {tally ? <p className="mt-2 font-heading leading-snug">{tally.sentence}</p> : <p className="mt-2 text-small text-muted-foreground">{results.error ? 'Could not load this record.' : 'Loading the record…'}</p>}
      <table className="mt-3 w-full text-small">
        <caption className="sr-only">Mean points per question in hearing {number}</caption>
        <thead>
          <tr className="text-left text-caption text-muted-foreground">
            <th className="py-1 font-normal">Party</th>
            {tally && <th className="py-1 text-right font-normal">Won · tied · lost</th>}
            <th className="py-1 text-right font-normal">Points per question</th>
          </tr>
        </thead>
        <tbody>
          {hearing.parties.map((party) => {
            const counts = tally?.parties.find((p) => p.key === party.key)
            return (
              <tr key={party.key} className="border-t border-paper-rule">
                <td className="py-1.5">{party.label}</td>
                {tally && <td className="py-1.5 text-right tabular-nums">{counts ? `${counts.wins} · ${counts.ties} · ${counts.losses}` : '—'}</td>}
                <td className="py-1.5 text-right tabular-nums">{party.meanPoints === null ? '—' : `${formatPoints(party.meanPoints)} of 6`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-caption text-muted-foreground">Points per question use the {plural(hearing.parties[0]?.questions ?? 0, 'question')} every selected hearing shares.</p>
    </Panel>
  )
}

function signed(value: number): string {
  const text = formatPoints(Math.abs(value))
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : '±0'
}

function AnchorSection({ data, name }: { data: ComparisonView; name: (runId: string) => string }) {
  if (data.anchors.length === 0) return <p className="max-w-3xl font-heading leading-relaxed">No setup was heard in every hearing, so scores across them are not on a common footing.</p>
  return (
    <div className="space-y-5">
      {data.anchors.map((anchor) => {
        const drift = data.hearings.map((hearing) => ({ runId: hearing.runId, value: anchor.byHearing[hearing.runId]?.meanPoints ?? null }))
        return (
          <div key={anchor.fingerprint} className="space-y-3">
            <p className="text-small text-muted-foreground">
              Anchor: <span className="font-medium text-foreground">{anchor.label}</span>, the same model and instructions in every hearing.
            </p>
            <ul className="max-w-3xl space-y-1.5 font-heading leading-relaxed">
              {data.relative
                .filter((item) => item.anchorFingerprint === anchor.fingerprint)
                .map((item) => (
                  <li key={`${item.runId}:${item.configurationKey}`}>
                    {name(item.runId).replace(/^h/, 'H')}: {item.label}{' '}
                    {item.meanDiff === null ? 'has no scores on the shared questions.' : `scored ${signed(item.meanDiff)} points per question against the anchor (better on ${item.better}, worse on ${item.worse}, tied on ${item.tied}; ${plural(item.questions, 'question')}, ${plural(item.raters, 'rater')}).`}
                  </li>
                ))}
            </ul>
            <p className="max-w-3xl text-small">
              <span className="font-medium">Panel drift:</span> the anchor scored {drift.map((d) => `${d.value === null ? '—' : formatPoints(d.value)} in ${name(d.runId)}`).join(', ')}. {new Set(drift.map((d) => d.value?.toFixed(2))).size > 1 ? 'The juries differed, or the model changed behind the same name.' : 'The same in each hearing.'}
            </p>
          </div>
        )
      })}
      {!data.comparable.sameRubric && <Note>The rubrics differ, so these points are on different scales. Read each hearing on its own.</Note>}
    </div>
  )
}
