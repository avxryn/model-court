import { ConversationSoFar, SheetSection, Term } from '@/components/court/CaseFile'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DIMENSIONS, rubricLines } from '@/domain/rubric'
import type { ResultsView } from '@/lib/dto'
import { ERROR_TEXT } from '@/lib/error-text'
import { formatDuration } from '@/lib/format'

type Question = ResultsView['cases'][number]

/** Every question with both testimonies side by side and every rating given; the first is open. */
export function TestimonySection({ data }: { data: ResultsView }) {
  const labels = Object.fromEntries(data.configurations.map((c) => [c.key, c.label]))
  return (
    <SheetSection id="evidence" label={<Term name="record" />}>
      <Accordion multiple defaultValue={data.cases.slice(0, 1).map((c) => c.key)} className="gap-4">
        {data.cases.map((testCase, index) => (
          <AccordionItem key={testCase.key} value={testCase.key} className="exhibit-panel overflow-hidden not-last:border-b-0">
            <AccordionTrigger className="items-center rounded-none px-5 py-4 hover:bg-slip hover:no-underline">
              <span className="flex flex-1 flex-wrap items-center justify-between gap-2 pr-2">
                <span className="font-heading text-base font-bold">
                  Q{index + 1}: {testCase.title}
                </span>
                {!testCase.eligible && <span className="text-xs font-normal text-warning">Excluded from scores</span>}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5 border-t border-paper-rule px-5 py-5">
              <QuestionRecord testCase={testCase} labels={labels} rubricVersion={data.rubricVersion} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </SheetSection>
  )
}

function QuestionRecord({ testCase, labels, rubricVersion }: { testCase: Question; labels: Record<string, string>; rubricVersion: string }) {
  const lines = rubricLines(rubricVersion)
  return (
    <>
      {testCase.messages.length > 0 && <ConversationSoFar messages={testCase.messages} />}
      <p className="font-heading">
        <span className="court-label mr-2">{testCase.messages.length > 0 ? 'Next message' : 'Question presented'}</span>
        {testCase.input}
      </p>
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
              <div className="max-h-72 overflow-y-auto rounded-md bg-paper px-4 py-3 font-heading text-reading leading-relaxed break-words whitespace-pre-wrap ring-1 ring-border outline-none ring-inset focus-visible:ring-3 focus-visible:ring-ring/50" tabIndex={0} role="region" aria-label={`${labels[response.configurationKey]} testimony`}>
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rated by</TableHead>
              <TableHead>Party</TableHead>
              {DIMENSIONS.map((d) => (
                <TableHead key={d} className="text-right">
                  {lines[d].label}
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
      )}
    </>
  )
}
