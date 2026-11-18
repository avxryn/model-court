import { SheetSection } from '@/components/court/CaseFile'
import { Fold } from '@/components/court/Fold'
import { Panel, Plain } from '@/components/court/Paper'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatScore } from '@/domain/rubric'
import type { ResultsView } from '@/lib/dto'

/**
 * How reliably testimony was taken, and findings by language when questions
 * are tagged. Folded behind a one-line headline; most readers need only that.
 */
export function ReliabilitySection({ data }: { data: ResultsView }) {
  const totals = data.configurations.reduce((sum, c) => ({ succeeded: sum.succeeded + data.coverage[c.key].succeeded, planned: sum.planned + data.coverage[c.key].planned, failed: sum.failed + data.coverage[c.key].failed + data.coverage[c.key].uncertain }), { succeeded: 0, planned: 0, failed: 0 })
  return (
    <SheetSection
      id="coverage"
      label={
        <>
          Reliability <Plain>how testimony was taken</Plain>
        </>
      }
    >
      <Fold
        summary={
          <span className="tabular-nums">
            <span className="text-foreground">
              {totals.succeeded}/{totals.planned} answers taken · {totals.failed} failed or uncertain · {data.excludedCaseKeys.length} question{data.excludedCaseKeys.length === 1 ? '' : 's'} excluded
            </span>
            {data.byLanguage.length > 0 && <> · findings by language</>}
          </span>
        }
        contentClassName="space-y-6"
      >
        <Coverage data={data} />
        {data.byLanguage.length > 0 && <ByLanguage data={data} />}
      </Fold>
    </SheetSection>
  )
}

function Coverage({ data }: { data: ResultsView }) {
  return (
    <div>
      <h3 className="mb-2 font-heading font-bold">Testimony taken</h3>
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Party</TableHead>
              <TableHead className="text-right">Succeeded / planned</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Uncertain</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
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
                  <TableCell className="text-right tabular-nums">{cov.truncatedCount}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Panel>
      <p className="mt-2 text-xs text-muted-foreground">
        {data.excludedCaseKeys.length} of {data.plannedCaseCount} planned questions were excluded from scoring because a party had no accepted testimony. Times and cost are under Cost and speed.
      </p>
    </div>
  )
}

function ByLanguage({ data }: { data: ResultsView }) {
  return (
    <div id="by-language">
      <h3 className="mb-2 font-heading font-bold">
        Findings by language <Plain>overall means; jury first, judge in brackets</Plain>
      </h3>
      <Panel>
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
      </Panel>
      <p className="mt-2 text-xs text-muted-foreground">Each language is scored on its own questions only. With few questions per language, treat differences as exploratory.</p>
    </div>
  )
}
