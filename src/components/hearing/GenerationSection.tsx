/**
 * Hearing testimony: progress of every planned generation, the table of
 * question × party outcomes, retries and opening deliberation. Once
 * deliberation opens this is history, so it folds to a one-line summary.
 */

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Fold } from '@/components/court/Fold'
import { Plain } from '@/components/court/Paper'
import type { Act } from '@/components/hearing/use-hearing-action'
import { StatusBadge } from '@/components/status/StatusBadge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, newIntentKey } from '@/lib/api-client'
import type { OwnerRunView } from '@/lib/dto'
import { ERROR_TEXT } from '@/lib/error-text'
import { formatDuration, plural } from '@/lib/format'
import { partySource } from '@/lib/parties'

export function GenerationSection({ run, busy, act, folded }: { run: OwnerRunView; busy: boolean; act: Act; folded: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { counts } = run
  const retryable = run.generations.some((g) => g.retryable)
  const terminal = counts.succeeded + counts.failed + counts.uncertain + counts.canceled
  const tally = `${terminal}/${counts.planned} finished · ${counts.succeeded} succeeded · ${counts.failed} failed · ${counts.uncertain} uncertain`
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const body = (
    <div className="space-y-4">
      <Progress value={(terminal / Math.max(counts.planned, 1)) * 100} aria-label="Generation progress" />
      {run.status === 'generating' && <p className="text-xs text-muted-foreground">Jobs run one at a time and survive closing this page. Each request has a 90-second deadline; there are no automatic paid retries.</p>}
      <GenerationTable run={run} selected={selected} onToggle={toggle} />
    </div>
  )

  return (
    <section aria-labelledby="progress-heading" className="space-y-4 border-t border-paper-rule px-5 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="progress-heading" className="court-label">
          Hearing testimony <Plain>generating responses</Plain>
        </h2>
        {!folded && (
          <span className="text-sm text-muted-foreground tabular-nums" role="status">
            {tally}
          </span>
        )}
      </div>
      {folded ? <Fold summary={<span className="tabular-nums">{tally} · show each question and party</span>}>{body}</Fold> : body}
      {(run.status === 'ready' || (run.status === 'generating' && retryable)) && (
        <div className="flex flex-wrap gap-2 border-t border-paper-rule pt-3">
          {retryable && <RetryButton run={run} selected={selected} busy={busy} act={act} onDone={() => setSelected(new Set())} />}
          {run.status === 'ready' && <OpenDeliberationButton run={run} busy={busy} act={act} />}
        </div>
      )}
    </section>
  )
}

function GenerationTable({ run, selected, onToggle }: { run: OwnerRunView; selected: Set<string>; onToggle: (id: string, on: boolean) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Case</TableHead>
          {run.configurations.map((c) => (
            <TableHead key={c.key} className="h-auto py-2.5 text-sm text-foreground">
              {c.label}
              <span className="block text-xs font-normal text-muted-foreground">{partySource(c)}</span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {run.cases.map((testCase) => (
          <TableRow key={testCase.key}>
            <TableCell className="font-medium">
              {testCase.title}
              {run.eligibility.excludedCaseKeys.includes(testCase.key) && run.status !== 'generating' && <span className="block text-xs font-normal text-warning">Not comparable (excluded)</span>}
            </TableCell>
            {run.configurations.map((c) => {
              const g = run.generations.find((x) => x.caseKey === testCase.key && x.configurationKey === c.key)
              if (!g) {
                const imported = run.imported.some((i) => i.caseKey === testCase.key && i.configurationKey === c.key)
                return (
                  <TableCell key={c.key} className="align-top text-sm text-muted-foreground">
                    {imported ? 'Imported answer' : '—'}
                  </TableCell>
                )
              }
              return (
                <TableCell key={c.key} className="align-top">
                  <div className="flex items-center gap-2">
                    {g.retryable && <Checkbox aria-label={`Select ${testCase.title} / ${c.label} for retry`} checked={selected.has(g.id)} onCheckedChange={(checked) => onToggle(g.id, checked === true)} />}
                    <StatusBadge status={g.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                    Attempt {g.attemptCount}/2 · {formatDuration(g.durationMs)}
                  </div>
                  {g.errorCode && <div className="mt-1 max-w-56 text-xs text-destructive">{ERROR_TEXT[g.errorCode] ?? g.errorCode}</div>}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function RetryButton({ run, selected, busy, act, onDone }: { run: OwnerRunView; selected: Set<string>; busy: boolean; act: Act; onDone: () => void }) {
  const uncertain = run.generations.filter((g) => selected.has(g.id) && g.status === 'uncertain').length
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" disabled={selected.size === 0 || busy} />}>
        <RefreshCw aria-hidden /> Retry selected ({selected.size})
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retry {plural(selected.size, 'generation')}?</AlertDialogTitle>
          <AlertDialogDescription>
            Each retry is a new paid request to your provider account and the last allowed attempt.
            {uncertain > 0 && ` ${uncertain} selected generation${uncertain === 1 ? ' has' : 's have'} an uncertain outcome: the provider may already have charged for the earlier attempt.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void act(() => api('POST', `/runs/${run.runId}/retries`, { body: { generationIds: [...selected], acknowledgePossiblePriorCharge: true }, revision: run.revision, idempotencyKey: newIntentKey() }), 'Retry queued', onDone)}>
            Retry and charge my account
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function OpenDeliberationButton({ run, busy, act }: { run: OwnerRunView; busy: boolean; act: Act }) {
  const [ack, setAck] = useState(false)
  const eligible = run.eligibility.caseKeys.length
  const excluded = run.eligibility.excludedCaseKeys.length
  if (eligible === 0) {
    return <p className="self-center text-sm text-destructive">No question has testimony from both parties, so there is nothing comparable to review. Retry failures or cancel.</p>
  }
  return (
    <AlertDialog onOpenChange={() => setAck(false)}>
      <AlertDialogTrigger render={<Button disabled={busy} />}>Open deliberation</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open blind review?</AlertDialogTitle>
          <AlertDialogDescription>
            {plural(eligible, 'question')} will be reviewed. The testimony is frozen: no more retries or replacements in this hearing. Next, summon jurors and do your own review.
            {eligible === 1 && ' With one question, treat any conclusion as exploratory.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {excluded > 0 && (
          <Field orientation="horizontal" className="items-start">
            <Checkbox id="ack-excluded" checked={ack} onCheckedChange={(c) => setAck(c === true)} />
            <FieldLabel htmlFor="ack-excluded" className="font-normal">
              Exclude {plural(excluded, 'incomplete question')}. Their failures still count in the reliability statistics.
            </FieldLabel>
          </Field>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction disabled={excluded > 0 && !ack} onClick={() => void act(() => api('POST', `/runs/${run.runId}/open-review`, { body: { acknowledgeExcludedCases: excluded > 0 }, revision: run.revision }), 'Deliberation opened')}>
            Open deliberation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
