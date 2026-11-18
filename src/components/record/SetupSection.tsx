/**
 * "Cost and speed" on the record (D-63): one decision row per party with the estimated
 * cost, median and slowest time, tokens, and failures, after unsealing only. Wide
 * screens get a table; narrow ones a stacked card per party, so nothing scrolls sideways.
 * `SetupTable` is shared with the sample page.
 */

import type { ReactNode } from 'react'
import { SheetSection } from '@/components/court/CaseFile'
import { Plain } from '@/components/court/Paper'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { recordTally } from '@/components/record/headline'
import { costHearing, costPerAnswer, costPerThousand, failures, priceSources, setupRows, setupSentence, speed, tokensPerAnswer, type SetupRow } from '@/components/record/setup-summary'
import type { ResultsView } from '@/lib/dto'
import { formatDate, plural } from '@/lib/format'
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
        {row.metrics.cost.perThousandMicroUsd !== null && <span className="block text-xs text-muted-foreground">at this hearing’s mix</span>}
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
          {t.note && <span className="block text-xs text-muted-foreground">{t.note}</span>}
        </>
      )
    },
    numeric: true,
  },
  { key: 'failures', head: 'Failures and retries', cell: (row) => failures(row.metrics) },
]

const IMPORTED_TEXT = 'Imported, not generated: no cost or timing'

function PartyName({ row }: { row: SetupRow }) {
  return (
    <>
      <span className="block font-medium text-foreground">{row.label}</span>
      <span className="block text-xs text-muted-foreground">{row.source}</span>
    </>
  )
}

export function SetupTable({ rows, caption }: { rows: readonly SetupRow[]; caption: string }) {
  return (
    <>
      <div className="hidden exhibit-panel overflow-hidden lg:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Party</TableHead>
              {COLUMNS.map((column) => (
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
                  <TableCell colSpan={COLUMNS.length} className="align-top whitespace-normal text-muted-foreground italic">
                    {IMPORTED_TEXT}
                  </TableCell>
                ) : (
                  COLUMNS.map((column) => (
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
              <p className="mt-2 text-sm text-muted-foreground italic">{IMPORTED_TEXT}</p>
            ) : (
              <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1.5 text-sm">
                {COLUMNS.map((column) => (
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
    <div className="mt-3 max-w-3xl space-y-1.5 text-xs leading-relaxed text-muted-foreground">
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
    </SheetSection>
  )
}
