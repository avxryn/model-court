/**
 * Automatic checks on the record (spec 03 §4.4, D-79): checks Model Court ran on each answer at no
 * cost, after the findings and splits and before the testimony. Never part of the jury's findings,
 * the headline or the verdict. Counts cover eligible questions only, like the findings.
 */

import { Check, X } from 'lucide-react'
import { SheetSection } from '@/components/court/CaseFile'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { CheckCounts, ChecksSummary } from '@/domain/kits/summary'
import type { CheckResult } from '@/domain/kits/types'
import type { ResultsView } from '@/lib/dto'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Party = { key: string; label: string }

export function countsText(counts: CheckCounts | undefined): string {
  if (!counts) return '—'
  // A check that could not run is neither a pass nor a fail, so it stays out of the count.
  const applicable = counts.pass + counts.fail
  const parts = [applicable > 0 ? `${counts.pass} of ${applicable} passed` : counts.error > 0 ? 'Could not run' : 'Did not apply']
  if (applicable > 0 && counts.na > 0) parts.push(`${counts.na} ${counts.na === 1 ? 'does' : 'do'} not apply`)
  if (applicable > 0 && counts.error > 0) parts.push(`${counts.error} could not run`)
  return parts.join(' · ')
}

/** One row per check, one column per party: "4 of 5 passed · 1 does not apply". Also the printable judgment's table. */
export function ChecksTable({ checks, parties, print = false }: { checks: ChecksSummary; parties: readonly Party[]; print?: boolean }) {
  return (
    <div className={cn(!print && 'exhibit-panel overflow-x-auto')}>
      <Table className={cn(print && '[&_td]:px-0 [&_td]:py-1.5 [&_th]:h-auto [&_th]:px-0 [&_th]:py-1.5 [&_thead_tr]:border-foreground')}>
        <caption className="sr-only">Automatic checks by party, on eligible questions</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Check</TableHead>
            {parties.map((party) => (
              <TableHead key={party.key} className="text-right">
                {party.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {checks.definitions.map((definition) => (
            <TableRow key={definition.id}>
              <TableCell className="min-w-32 align-top whitespace-normal sm:min-w-48">
                <span className="font-medium">{definition.label}</span>
                {!print && <span className="mt-0.5 hidden max-w-sm text-caption leading-snug text-muted-foreground sm:block">{definition.description}</span>}
              </TableCell>
              {parties.map((party) => (
                <TableCell key={party.key} className="text-right align-top whitespace-normal tabular-nums">
                  {countsText(checks.byConfiguration[party.key]?.[definition.id])}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow className={cn('font-semibold', print ? 'hover:bg-transparent' : 'bg-slip hover:bg-slip')}>
            <TableCell>Passed every check</TableCell>
            {parties.map((party) => {
              const all = checks.allPassed[party.key]
              return (
                <TableCell key={party.key} className="text-right tabular-nums">
                  {all && all.denominator > 0 ? `${all.numerator} of ${plural(all.denominator, 'question')}` : '—'}
                </TableCell>
              )
            })}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

function metricText(metric: ChecksSummary['metrics'][number], key: string): string {
  if (metric.values) {
    const value = metric.values[key]
    return value === null || value === undefined ? '—' : `${Number.isInteger(value) ? value : value.toFixed(1)}${metric.unit ? ` ${metric.unit}` : ''}`
  }
  const fraction = metric.byConfiguration[key]
  return fraction ? `${fraction.numerator} of ${plural(fraction.denominator, 'question')}` : 'No answer key'
}

function resultOf(results: readonly CheckResult[] | null | undefined, id: string) {
  return results?.find((result) => result.checkId === id)
}

export interface LabelRow {
  caseKey: string
  number: number
  eligible: boolean
  expected: string
  said: Record<string, { label: string | null; correct: boolean }>
}

/** Classification only: per question, the expected label and what each party said, right or wrong. */
export function labelRows(data: ResultsView, parties: readonly Party[]): LabelRow[] {
  if (data.kit?.version !== 'classification-v1') return []
  return data.cases.flatMap((testCase, index) => {
    const responses = testCase.responses as Array<{ configurationKey: string; checks?: CheckResult[] | null }>
    const expected = responses.map((response) => resultOf(response.checks, 'label-correct')?.detail.expected).find((value) => typeof value === 'string')
    if (typeof expected !== 'string') return []
    const said = Object.fromEntries(
      parties.map((party) => {
        const own = responses.find((response) => response.configurationKey === party.key)?.checks
        const predicted = resultOf(own, 'label-format')?.detail.predicted
        return [party.key, { label: typeof predicted === 'string' ? predicted : null, correct: resultOf(own, 'label-correct')?.status === 'pass' }]
      }),
    )
    return [{ caseKey: testCase.key, number: index + 1, eligible: testCase.eligible, expected, said }]
  })
}

function LabelTable({ rows, parties }: { rows: readonly LabelRow[]; parties: readonly Party[] }) {
  return (
    <div className="exhibit-panel mt-4 overflow-x-auto">
      <Table>
        <caption className="sr-only">The expected label and each party’s label, per question</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Question</TableHead>
            <TableHead>Expected</TableHead>
            {parties.map((party) => (
              <TableHead key={party.key}>{party.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.caseKey}>
              <TableCell className="align-top whitespace-nowrap">
                Q{row.number}
                {!row.eligible && <span className="block text-caption text-warning">Excluded from scores</span>}
              </TableCell>
              <TableCell className="align-top whitespace-normal">{row.expected}</TableCell>
              {parties.map((party) => {
                const said = row.said[party.key]
                const Icon = said?.correct ? Check : X
                return (
                  <TableCell key={party.key} className="align-top whitespace-normal">
                    <span className="block">{said?.label ?? 'No allowed label'}</span>
                    <span className={cn('inline-flex items-center gap-1 text-caption', said?.correct ? 'text-muted-foreground' : 'text-destructive')}>
                      <Icon aria-hidden className="size-3.5" />
                      {said?.correct ? 'Matches' : 'Does not match'}
                    </span>
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ChecksSection({ data }: { data: ResultsView }) {
  const checks = data.checks
  if (!checks) return null
  const parties = data.configurations.map((c) => ({ key: c.key, label: c.label }))
  const rows = labelRows(data, parties)
  const samples = checks.allPassedSamples
  const excluded = data.cases.filter((testCase) => !testCase.eligible).length
  return (
    <SheetSection id="checks" label="Automatic checks">
      <p className="max-w-2xl text-small leading-relaxed text-muted-foreground">
        Checks Model Court ran on each answer, at no extra cost{data.kit ? ` (${data.kit.name} kit)` : ''}. They are not part of the jury’s findings.
        {excluded > 0 ? ` Counts leave out the ${plural(excluded, 'question')} excluded from scoring.` : ''}
      </p>
      {checks.metrics.length > 0 && (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {checks.metrics.map((metric) => (
            <div key={metric.id} className="rounded-md border border-paper-rule px-4 py-3">
              <dt className="text-small font-medium">{metric.label}</dt>
              <dd className="mt-1 space-y-0.5 text-small tabular-nums">
                {parties.map((party) => (
                  <div key={party.key} className="flex flex-wrap justify-between gap-x-4">
                    <span className="text-muted-foreground">{party.label}</span>
                    <span>{metricText(metric, party.key)}</span>
                  </div>
                ))}
                {metric.id === 'invalid-labels' && <p className="pt-1 text-caption leading-snug text-muted-foreground">Lower is better.</p>}
                {metric.caveat && <p className="pt-1 text-caption leading-snug text-muted-foreground">{metric.caveat}</p>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-4">
        <ChecksTable checks={checks} parties={parties} />
      </div>
      {samples && (
        <p className="mt-2 text-small text-muted-foreground tabular-nums">
          Across every sample:{' '}
          {parties
            .filter((party) => samples[party.key])
            .map((party) => `${party.label} passed every check in ${samples[party.key].numerator} of ${plural(samples[party.key].denominator, 'sample')}`)
            .join('; ')}
          .
        </p>
      )}
      {rows.length > 0 && <LabelTable rows={rows} parties={parties} />}
    </SheetSection>
  )
}
