/**
 * "Cost and speed" on the record (D-63): one decision row per party with the estimated
 * cost, median and slowest time, tokens, and failures, after unsealing only. Wide
 * screens get a table; narrow ones a stacked card per party, so nothing scrolls sideways.
 * `SetupTable` is shared with the sample page.
 */

import type { ReactNode } from 'react'
import { SheetSection } from '@/components/court/CaseFile'
import { Fold } from '@/components/court/Fold'
import { Plain } from '@/components/court/Paper'
import { recordTally } from '@/components/record/headline'
import { consistency, costHearing, costPerAnswer, costPerThousand, failures, priceSources, setupRows, setupSentence, speed, tokensPerAnswer, type SetupRow } from '@/components/record/setup-summary'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ResultsView } from '@/lib/dto'
import { ERROR_TEXT } from '@/lib/error-text'
import { formatDate, formatDuration, plural } from '@/lib/format'
import { partySource } from '@/lib/parties'
import { cn } from '@/lib/utils'

interface Column {
  key: string
  head: string
  cell: (row: SetupRow) => ReactNode
  numeric?: boolean
}

const COLUMNS: Column[] = [
  { key: 'answer', head: 'Cost per answer', cell: (row) => costPerAnswer(row.metrics), numeric: true },
  { key: 'hearing', head: 'This hearing', cell: (row) => costHearing(row.metrics), numeric: true },
  {
    key: 'thousand',
    head: 'Per 1,000 answers',
    cell: (row) => (
      <>
        {costPerThousand(row.metrics)}
        {row.metrics.cost.perThousandMicroUsd !== null && <span className="block text-caption text-muted-foreground">at this hearing’s mix</span>}
      </>
    ),
    numeric: true,
  },
  { key: 'speed', head: 'Median / slowest', cell: (row) => speed(row.metrics), numeric: true },
  {
    key: 'tokens',
    head: 'Tokens per answer',
    cell: (row) => {
      const t = tokensPerAnswer(row)
      return (
        <>
          {t.main}
          {t.note && <span className="block text-caption text-muted-foreground">{t.note}</span>}
        </>
      )
    },
    numeric: true,
  },
  { key: 'failures', head: 'Failures and retries', cell: (row) => failures(row.metrics) },
]

/** Only with repeats (D-66). */
const CONSISTENCY: Column = { key: 'consistency', head: 'Consistency', cell: (row) => consistency(row.metrics) }

function columnsFor(rows: readonly SetupRow[]): Column[] {
  return rows.some((row) => row.metrics.consistency) ? [...COLUMNS, CONSISTENCY] : COLUMNS
}

const IMPORTED_TEXT = 'Imported, not generated: no cost or timing'

function PartyName({ row }: { row: SetupRow }) {
  return (
    <>
      <span className="block font-medium text-foreground">{row.label}</span>
      <span className="block text-caption text-muted-foreground">{row.source}</span>
    </>
  )
}

export function SetupTable({ rows, caption }: { rows: readonly SetupRow[]; caption: string }) {
  const columns = columnsFor(rows)
  return (
    <>
      <div className="hidden exhibit-panel overflow-hidden lg:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Party</TableHead>
              {columns.map((column) => (
                <TableHead key={column.key} className={cn('whitespace-normal', column.numeric && 'text-right')}>
                  {column.head}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="align-top whitespace-normal">
                  <PartyName row={row} />
                </TableCell>
                {row.metrics.source === 'imported' ? (
                  <TableCell colSpan={columns.length} className="align-top whitespace-normal text-muted-foreground italic">
                    {IMPORTED_TEXT}
                  </TableCell>
                ) : (
                  columns.map((column) => (
                    <TableCell key={column.key} className={cn('align-top whitespace-normal', column.numeric && 'text-right tabular-nums')}>
                      {column.cell(row)}
                    </TableCell>
                  ))
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-3 lg:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={row.key} className="exhibit-panel px-4 py-3">
            <PartyName row={row} />
            {row.metrics.source === 'imported' ? (
              <p className="mt-2 text-small text-muted-foreground italic">{IMPORTED_TEXT}</p>
            ) : (
              <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1.5 text-small">
                {columns.map((column) => (
                  <div key={column.key} className="contents">
                    <dt className="text-muted-foreground">{column.head}</dt>
                    <dd className="tabular-nums">{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

export function SetupFootnote({ rows, priceTable, eligibleCount, illustrative = false }: { rows: readonly SetupRow[]; priceTable: ResultsView['priceTable']; eligibleCount: number; illustrative?: boolean }) {
  const generated = rows.filter((row) => row.metrics.source === 'generated')
  const answers = generated.length ? Math.min(...generated.map((row) => row.metrics.latency.n)) : 0
  const upperBound = generated.some((row) => row.metrics.cost.cachedAssumedFull > 0)
  const read = formatDate(Date.parse(`${priceTable.readOn}T12:00:00Z`))
  const sources = priceSources(priceTable.sources)
  return (
    <div className="mt-3 max-w-3xl space-y-1.5 text-caption leading-relaxed text-muted-foreground">
      {illustrative ? (
        <p>Illustrative numbers, written by hand for this sample: no model was called and no price was read for them.</p>
      ) : (
        <p>
          Estimated at list prices from price table {priceTable.version} (read {read}, from{' '}
          {sources.map((source, index) => (
            <span key={source.url}>
              {index > 0 && ' and '}
              <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
                {source.name}’s pricing page
              </a>
            </span>
          ))}
          ).{priceTable.predates && ' These prices were read after this hearing took place, so they may differ from what was charged then.'} Your provider bill is the authority; it can differ because of discounts, cached input, taxes, or failed calls that were still charged.
        </p>
      )}
      <p>
        Per-answer figures and times use succeeded answers on the {plural(eligibleCount, 'question')} every party answered; “This hearing” counts every call made. Times include network overhead and exclude waiting in the queue.
        {answers > 0 && answers <= 15 && ` With ${plural(answers, 'answer')} per party, “slowest” is a single call.`}
        {upperBound && ' Cached input was not recorded for some calls, so it is priced at the full input rate: those estimates are an upper bound.'}
      </p>
    </div>
  )
}

export function SetupSection({ data }: { data: ResultsView }) {
  const rows = setupRows(data, partySource)
  if (rows.length === 0) return null
  const tally = recordTally(data)
  return (
    <SheetSection
      id="setup"
      label={
        <>
          Cost and speed <Plain>estimates, not charges</Plain>
        </>
      }
    >
      <p className="mb-4 max-w-3xl font-heading leading-relaxed">{setupSentence(tally, rows)}</p>
      <SetupTable rows={rows} caption="Estimated cost, speed and failures for each party" />
      <SetupFootnote rows={rows} priceTable={data.priceTable} eligibleCount={data.eligibleCaseKeys.length} />
      {data.samplesPerAnswer > 1 && <EverySample data={data} />}
    </SheetSection>
  )
}

/**
 * With repeats (D-66): every sample of every question, parties side by side, the one the jury
 * scored marked. Judge and jurors see it only after unsealing, like the rest of the record.
 */
/** Exported for render tests only; the record renders it inside a closed fold. */
export function EverySampleForTest({ data }: { data: ResultsView }) {
  return <SampleList data={data} />
}

function EverySample({ data }: { data: ResultsView }) {
  return (
    <Fold className="mt-5" summary={<span className="font-medium text-foreground">Read every sample ({data.samplesPerAnswer} per party per question)</span>}>
      <SampleList data={data} />
    </Fold>
  )
}

function SampleList({ data }: { data: ResultsView }) {
  const generated = data.configurations.filter((c) => c.provider !== null)
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-small leading-relaxed text-muted-foreground">Wording overlap compares letters, not meaning: two answers can agree in different words. Read the samples before you conclude.</p>
      {data.cases.map((testCase, index) => (
        <section key={testCase.key} aria-labelledby={`samples-${testCase.key}`} className="space-y-3">
          <h3 id={`samples-${testCase.key}`} className="font-heading font-bold">
            Q{index + 1}: {testCase.title}
            {!testCase.eligible && <span className="ml-2 text-caption font-normal text-warning">Excluded from scores</span>}
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {generated.map((party) => {
              const response = testCase.responses.find((r) => r.configurationKey === party.key)
              const samples = response && 'samples' in response ? (response.samples ?? []) : []
              return (
                <div key={party.key} className="exhibit-panel min-w-0 px-4 py-3">
                  <p className="text-small font-semibold">{party.label}</p>
                  <ol className="mt-2 space-y-3">
                    {samples.map((sample) => (
                      <li key={sample.sampleNo} className="border-t border-paper-rule pt-2 first:border-t-0 first:pt-0">
                        <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground tabular-nums">
                          <span className="font-medium text-foreground">Sample {sample.sampleNo}</span>
                          {sample.primary && <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 font-medium text-primary">scored by the jury</span>}
                          {sample.status !== 'succeeded' && <StatusBadge status={sample.status} />}
                          {sample.status === 'succeeded' && <span>{formatDuration(sample.durationMs)}{sample.outputTokens !== null && ` · ${sample.outputTokens.toLocaleString('en-US')} tokens out`}</span>}
                        </div>
                        {sample.text !== null ? (
                          <p className="mt-1.5 font-heading text-reading leading-relaxed break-words whitespace-pre-wrap">{sample.text}</p>
                        ) : (
                          <p className="mt-1.5 text-caption text-muted-foreground">{sample.errorCode ? (ERROR_TEXT[sample.errorCode] ?? sample.errorCode) : 'No answer.'}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
