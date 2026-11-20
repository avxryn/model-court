import { useEffect, useState } from 'react'
import { ConversationSoFar, SheetSection, Term } from '@/components/court/CaseFile'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { CheckResult } from '@/domain/kits/types'
import { DIMENSIONS, rubricLines } from '@/domain/rubric'
import { TestimonyChecks } from '@/components/record/TestimonyChecks'
import { CitedText } from '@/components/review/CitedTestimony'
import { ToolTraceView } from '@/components/review/ToolTrace'
import { jurorTrace, type ToolTrace } from '@/domain/tools/trace'
import type { StepUsage } from '@/lib/dto'
import { showSource, SourceList, type ListedSource } from '@/components/review/SourceList'
import type { Span } from '@/domain/grounded/match'
import { groundingKeyText } from '@/domain/grounded/sources'
import { quoteFindings } from '@/lib/citations-view'
import type { ResultsView } from '@/lib/dto'
import { ERROR_TEXT } from '@/lib/error-text'
import { formatDuration } from '@/lib/format'
import { TestimonyDeck } from '@/components/review/TestimonyDeck'
import { ONE_AT_A_TIME_FROM } from '@/domain/parties'

type Question = ResultsView['cases'][number]

/**
 * Every question with both testimonies side by side and every rating given;
 * the first is open. A link to #q-<key> (from "Where the jury split") opens
 * that question and scrolls to it.
 */
export function TestimonySection({ data }: { data: ResultsView }) {
  const labels = Object.fromEntries(data.configurations.map((c) => [c.key, c.label]))
  const checkLabels = Object.fromEntries((data.checks?.definitions ?? []).map((definition) => [definition.id, definition.label]))
  // Spec 05 (D-96): a grounded hearing's frozen sources, with the judge's notes, after unsealing.
  const grounded = (data as { grounded?: { sources: Array<{ caseKey: string; items: ListedSource[] }> } }).grounded
  const sourcesOf = (caseKey: string) => (grounded ? (grounded.sources.find((entry) => entry.caseKey === caseKey)?.items ?? []) : undefined)
  const [open, setOpen] = useState<string[]>(() => data.cases.slice(0, 1).map((c) => c.key))
  useEffect(() => {
    const follow = () => {
      const key = decodeURIComponent(window.location.hash.replace(/^#q-/, ''))
      if (!window.location.hash.startsWith('#q-') || !data.cases.some((c) => c.key === key)) return
      setOpen((current) => (current.includes(key) ? current : [...current, key]))
      requestAnimationFrame(() => document.getElementById(`q-${key}`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
    }
    follow()
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [data.cases])
  return (
    <SheetSection id="evidence" label={<Term name="record" />}>
      <Accordion multiple value={open} onValueChange={(next) => setOpen(next as string[])} className="gap-4">
        {data.cases.map((testCase, index) => (
          <AccordionItem key={testCase.key} id={`q-${testCase.key}`} value={testCase.key} className="exhibit-panel scroll-mt-28 overflow-hidden not-last:border-b-0">
            <AccordionTrigger className="items-center rounded-none px-5 py-4 hover:bg-slip hover:no-underline">
              <span className="flex flex-1 flex-wrap items-center justify-between gap-2 pr-2">
                <span className="font-heading text-base font-bold">
                  Q{index + 1}: {testCase.title}
                </span>
                {!testCase.eligible && <span className="text-caption font-normal text-warning">Excluded from scores</span>}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5 border-t border-paper-rule px-5 py-5">
              <QuestionRecord testCase={testCase} labels={labels} checkLabels={checkLabels} rubricVersion={data.rubricVersion} sources={sourcesOf(testCase.key)} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </SheetSection>
  )
}

function QuestionRecord({ testCase, labels, checkLabels, rubricVersion, sources }: { testCase: Question; labels: Record<string, string>; checkLabels: Record<string, string>; rubricVersion: string; sources?: ListedSource[] }) {
  const lines = rubricLines(rubricVersion)
  // Spec 05: where each party's quotes were found, highlighted in the sources (check facts; the record is unsealed).
  const findings = sources ? new Map(testCase.responses.map((response) => [response.configurationKey, response.text ? quoteFindings(response.text, sources) : []])) : null
  const highlights = new Map<number, Span[]>()
  for (const list of findings?.values() ?? []) for (const finding of list) if (finding.foundIn !== null) highlights.set(finding.foundIn, [...(highlights.get(finding.foundIn) ?? []), ...finding.spans])
  const key = (testCase as { kitFields?: { kind?: string; answerable?: 'yes' | 'partly' | 'no'; requiredSources?: number[] } | null }).kitFields
  return (
    <>
      {testCase.messages.length > 0 && <ConversationSoFar messages={testCase.messages} />}
      <p className="font-heading">
        <span className="court-label mr-2">{testCase.messages.length > 0 ? 'Next message' : 'Question presented'}</span>
        {testCase.input}
      </p>
      <p className="text-caption text-muted-foreground">Jury instructions: {testCase.expectedBehavior}</p>
      {sources && key?.kind === 'grounded' && key.answerable && <p className="text-caption text-muted-foreground">{groundingKeyText({ answerable: key.answerable, requiredSources: key.requiredSources ?? [] })}</p>}
      {sources && <SourceList caseKey={`record-${testCase.key}`} sources={sources} highlights={highlights} />}
      {(() => {
        // Spec 07 §9.4 (D-111): from four parties on, the same tabs and "Compare two" as the worksheet.
        const card = (response: Question['responses'][number]) => (
          <div key={response.configurationKey} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-small font-semibold">{labels[response.configurationKey]}</span>
              <span className="text-caption text-muted-foreground tabular-nums">
                {response.status === 'imported' ? (
                  'Imported answer'
                ) : (
                  <>
                    {formatDuration(response.durationMs)} · tokens in {response.inputTokens ?? 'unavailable'} / out {response.outputTokens ?? 'unavailable'}
                    {response.truncated && ' · truncated at the output limit'}
                  </>
                )}
              </span>
            </div>
            {response.modelNote && <p className="text-caption text-warning">{response.modelNote}</p>}
            {(response as { trace?: ToolTrace }).trace ? (
              // Spec 06 §3 (D-103): after unsealing, which response answered each call and per-step usage.
              <ToolTraceView label={labels[response.configurationKey] ?? ''} trace={jurorTrace((response as { trace: ToolTrace }).trace)} full={(response as { trace: ToolTrace }).trace} usage={(response as { steps?: StepUsage[] }).steps} maxSteps={(testCase as { kitFields?: { maxSteps?: number } | null }).kitFields?.maxSteps} />
            ) : response.text ? (
              <div className="max-h-72 overflow-y-auto rounded-md bg-paper px-4 py-3 font-heading text-reading leading-relaxed break-words whitespace-pre-wrap ring-1 ring-border outline-none ring-inset focus-visible:ring-3 focus-visible:ring-ring/50" tabIndex={0} role="region" aria-label={`${labels[response.configurationKey]} testimony`}>
                {sources ? <CitedText text={response.text} caseKey={`record-${testCase.key}`} sources={sources} /> : response.text}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border p-3 text-small text-muted-foreground">
                No accepted response ({response.status}). {response.errorCode ? ERROR_TEXT[response.errorCode] ?? response.errorCode : ''}
              </p>
            )}
            {findings && (findings.get(response.configurationKey)?.length ?? 0) > 0 && (
              <ul aria-label={`${labels[response.configurationKey]} quotes`} className="space-y-1 text-caption">
                {findings.get(response.configurationKey)!.map((finding, index) => (
                  <li key={index} className={finding.foundIn === null ? 'text-destructive' : 'text-muted-foreground'}>
                    <q className="italic">{finding.quote.length > 80 ? `${finding.quote.slice(0, 79)}…` : finding.quote}</q>{' '}
                    {finding.foundIn !== null ? (
                      <>
                        found in{' '}
                        <button type="button" className="underline" onClick={() => showSource(`record-${testCase.key}`, finding.foundIn!)}>
                          S{finding.foundIn}
                        </button>
                      </>
                    ) : (
                      `not found in ${finding.cited.map((n) => `S${n}`).join(' or ')}`
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(response as { checks?: CheckResult[] | null }).checks && <TestimonyChecks results={(response as { checks: CheckResult[] }).checks} labels={checkLabels} party={labels[response.configurationKey]} />}
          </div>
        )
        return testCase.responses.length >= ONE_AT_A_TIME_FROM ? (
          <TestimonyDeck key={testCase.key} noun="Party" keys={false} items={testCase.responses.map((response) => ({ key: response.configurationKey, label: labels[response.configurationKey] ?? response.configurationKey, node: card(response) }))} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">{testCase.responses.map(card)}</div>
        )
      })()}
      {testCase.judgments.length > 0 && (
        <Table region={`Ratings for ${testCase.title}`}>
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
                <TableCell className="min-w-48 text-caption text-muted-foreground">
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
