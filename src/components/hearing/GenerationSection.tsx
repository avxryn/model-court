/**
 * Hearing testimony: progress of every planned generation, the table of
 * question × party outcomes, retries and opening deliberation. Once
 * deliberation opens this is history, so it folds to a one-line summary.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, RefreshCw } from 'lucide-react'
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
import { PROVIDER_NAMES, type ProviderId } from '@/domain/registry'
import { api, newIntentKey } from '@/lib/api-client'
import type { CredentialMetadata, OwnerRunView } from '@/lib/dto'
import { ERROR_TEXT } from '@/lib/error-text'
import { formatDuration, plural } from '@/lib/format'
import { partySource } from '@/lib/parties'
import { useApi } from '@/lib/use-api'

/** D-57: a provider whose pinned key was removed or expired, and the judge's current key for it, if any. */
interface StaleKey {
  provider: ProviderId
  current: CredentialMetadata | null
}

function staleKeys(run: OwnerRunView, keys: readonly CredentialMetadata[], now: number): StaleKey[] {
  return run.pinnedKeys
    .filter((pin) => !pin.usable)
    .map((pin) => ({
      provider: pin.provider,
      current: keys.find((key) => key.provider === pin.provider && key.id !== pin.credentialId && (key.expiresAt === null || key.expiresAt > now)) ?? null,
    }))
}

function providerOf(run: OwnerRunView, configurationKey: string): ProviderId | null {
  return run.configurations.find((c) => c.key === configurationKey)?.provider ?? null
}

export function GenerationSection({ run, busy, act, folded }: { run: OwnerRunView; busy: boolean; act: Act; folded: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { counts } = run
  const retryable = run.generations.some((g) => g.retryable)
  const needsRepin = retryable && run.pinnedKeys.some((pin) => !pin.usable)
  const keys = useApi<{ items: CredentialMetadata[] }>(needsRepin ? '/credentials' : null)
  const stale = needsRepin ? staleKeys(run, keys.data?.items ?? [], Date.now()) : []
  const terminal = counts.succeeded + counts.failed + counts.uncertain + counts.canceled
  const tally = counts.planned === 0 ? 'Imported answers only · nothing to generate' : `${terminal}/${counts.planned} finished · ${counts.succeeded} succeeded · ${counts.failed} failed · ${counts.uncertain} uncertain`
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
      {run.status === 'generating' && <p className="text-caption text-muted-foreground">Jobs run one at a time and survive closing this page. Each request has a 90-second deadline; there are no automatic paid retries.</p>}
      <GenerationTable run={run} selected={selected} onToggle={toggle} />
    </div>
  )

  return (
    <section aria-labelledby="progress-heading" className="space-y-4 border-t border-paper-rule px-5 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="progress-heading" className="court-label">
          Hearing testimony <Plain>{counts.planned === 0 ? 'imported answers' : 'generating responses'}</Plain>
        </h2>
        {!folded && (
          <span className="text-small text-muted-foreground tabular-nums" role="status">
            {tally}
          </span>
        )}
      </div>
      {folded ? <Fold summary={<span className="tabular-nums">{tally} · show each question and party</span>}>{body}</Fold> : body}
      {(run.status === 'ready' || (run.status === 'generating' && retryable)) && (
        <div className="flex flex-wrap gap-2 border-t border-paper-rule pt-3">
          {stale.length > 0 && keys.data && <StaleKeyNotice stale={stale} />}
          {retryable && <RetryButton run={run} selected={selected} stale={stale} keysLoading={needsRepin && !keys.data} busy={busy} act={act} onDone={() => setSelected(new Set())} />}
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
            <TableHead key={c.key} className="h-auto py-2.5 text-small text-foreground">
              {c.label}
              <span className="block text-caption font-normal text-muted-foreground">{partySource(c)}</span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {run.cases.map((testCase) => (
          <TableRow key={testCase.key}>
            <TableCell className="font-medium">
              {testCase.title}
              {run.eligibility.excludedCaseKeys.includes(testCase.key) && run.status !== 'generating' && <span className="block text-caption font-normal text-warning">Not comparable (excluded)</span>}
            </TableCell>
            {run.configurations.map((c) => {
              const samples = run.generations.filter((x) => x.caseKey === testCase.key && x.configurationKey === c.key).sort((a, b) => a.sampleNo - b.sampleNo)
              const g = samples[0]
              if (!g) {
                const imported = run.imported.some((i) => i.caseKey === testCase.key && i.configurationKey === c.key)
                return (
                  <TableCell key={c.key} className="align-top text-small text-muted-foreground">
                    {imported ? 'Imported answer' : '—'}
                  </TableCell>
                )
              }
              if (samples.length > 1) {
                return (
                  <TableCell key={c.key} className="align-top">
                    <SampleCell samples={samples} label={`${testCase.title} / ${c.label}`} selected={selected} onToggle={onToggle} />
                  </TableCell>
                )
              }
              return (
                <TableCell key={c.key} className="align-top">
                  <div className="flex items-center gap-2">
                    {g.retryable && <Checkbox aria-label={`Select ${testCase.title} / ${c.label} for retry`} checked={selected.has(g.id)} onCheckedChange={(checked) => onToggle(g.id, checked === true)} />}
                    <StatusBadge status={g.status} />
                  </div>
                  <div className="mt-1 text-caption text-muted-foreground tabular-nums">
                    Attempt {g.attemptCount}/2 · {formatDuration(g.durationMs)}
                  </div>
                  {/* Spec 06 §3 (D-103): a tool loop's progress; the cap and the real count, never tokens before unsealing. */}
                  {g.steps && <div className="mt-1 text-caption text-muted-foreground tabular-nums">{stepLine(g.status, g.steps)}</div>}
                  {g.errorCode && <div className="mt-1 max-w-56 text-caption text-destructive">{ERROR_TEXT[g.errorCode] ?? g.errorCode}</div>}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

type GenerationRowView = OwnerRunView['generations'][number]

const DOT: Record<string, string> = { succeeded: 'bg-primary', failed: 'bg-destructive', uncertain: 'bg-warning', canceled: 'bg-muted-foreground', running: 'bg-primary/40', pending: 'bg-transparent' }

/** With repeats (D-66): sample dots (filled = answered) and one line per sample, each retried on its own. */
function SampleCell({ samples, label, selected, onToggle }: { samples: GenerationRowView[]; label: string; selected: Set<string>; onToggle: (id: string, on: boolean) => void }) {
  const done = samples.filter((s) => s.status === 'succeeded').length
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1" role="img" aria-label={`${done} of ${samples.length} samples answered`}>
        {samples.map((s) => (
          <span key={s.id} aria-hidden className={`size-2.5 rounded-full border border-foreground/40 ${DOT[s.status] ?? 'bg-transparent'}`} />
        ))}
        <span className="ml-1 text-caption text-muted-foreground tabular-nums">
          {done}/{samples.length}
        </span>
      </div>
      <ol className="space-y-1">
        {samples.map((s) => (
          <li key={s.id} className="text-caption">
            <div className="flex items-center gap-2">
              {s.retryable && <Checkbox aria-label={`Select ${label}, sample ${s.sampleNo}, for retry`} checked={selected.has(s.id)} onCheckedChange={(checked) => onToggle(s.id, checked === true)} />}
              <span className="text-muted-foreground tabular-nums">Sample {s.sampleNo}</span>
              <StatusBadge status={s.status} />
            </div>
            <div className="mt-0.5 text-muted-foreground tabular-nums">
              Attempt {s.attemptCount}/2 · {formatDuration(s.durationMs)}
            </div>
            {s.errorCode && <div className="mt-0.5 max-w-56 text-destructive">{ERROR_TEXT[s.errorCode] ?? s.errorCode}</div>}
          </li>
        ))}
      </ol>
    </div>
  )
}

function StaleKeyNotice({ stale }: { stale: StaleKey[] }) {
  return (
    <div className="flex basis-full items-start gap-2 text-small" role="status">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        {stale.map(({ provider, current }) => {
          const name = PROVIDER_NAMES[provider]
          return current ? (
            <p key={provider}>
              The {name} key pinned to this hearing was removed or expired. A retry will use your current {name} key ({current.label}) instead.
            </p>
          ) : (
            <p key={provider}>
              The {name} key pinned to this hearing was removed or expired, and you have no current {name} key.{' '}
              <Link to="/settings/api-keys" className="underline underline-offset-4">
                Add one in Provider keys
              </Link>
              , then retry here.
            </p>
          )
        })}
      </div>
    </div>
  )
}

/** "Step 2 of up to 4" while running; "Answered in 3 of up to 4 calls" when done. */
export function stepLine(status: string, steps: { used: number; max: number }): string {
  if (status === 'pending') return `Up to ${steps.max} ${steps.max === 1 ? 'call' : 'calls'}`
  if (status === 'running') return `Step ${Math.max(1, steps.used)} of up to ${steps.max}`
  return `${steps.used} of up to ${steps.max} ${steps.max === 1 ? 'call' : 'calls'} used`
}

function RetryButton({ run, selected, stale, keysLoading, busy, act, onDone }: { run: OwnerRunView; selected: Set<string>; stale: StaleKey[]; keysLoading: boolean; busy: boolean; act: Act; onDone: () => void }) {
  const uncertain = run.generations.filter((g) => selected.has(g.id) && g.status === 'uncertain').length
  const providers = new Set(run.generations.filter((g) => selected.has(g.id)).map((g) => providerOf(run, g.configurationKey)))
  const affected = stale.filter((key) => providers.has(key.provider))
  const blocked = keysLoading || affected.some((key) => !key.current)
  const credentialIdsByProvider = Object.fromEntries(affected.flatMap((key) => (key.current ? [[key.provider, key.current.id]] : [])))
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" disabled={selected.size === 0 || busy || blocked} />}>
        <RefreshCw aria-hidden /> Retry selected ({selected.size})
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retry {plural(selected.size, 'generation')}?</AlertDialogTitle>
          <AlertDialogDescription>
            {run.generations.some((g) => selected.has(g.id) && g.steps)
              ? `A tool-use retry starts again from step 1 and may make up to ${run.generations.filter((g) => selected.has(g.id)).reduce((sum, g) => sum + (g.steps?.max ?? 1), 0)} paid calls; the failed attempt’s earlier calls were billed. It is the last allowed attempt.`
              : 'Each retry is a new paid request to your provider account and the last allowed attempt.'}
            {uncertain > 0 && ` ${uncertain} selected generation${uncertain === 1 ? ' has' : 's have'} an uncertain outcome: the provider may already have charged for the earlier attempt.`}
            {affected.map((key) => ` This hearing will use your current ${PROVIDER_NAMES[key.provider]} key (${key.current?.label ?? ''}) from now on, in place of the removed one.`).join('')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void act(() => api('POST', `/runs/${run.runId}/retries`, { body: { generationIds: [...selected], acknowledgePossiblePriorCharge: true, ...(affected.length > 0 ? { credentialIdsByProvider } : {}) }, revision: run.revision, idempotencyKey: newIntentKey() }), 'Retry queued', onDone)}>
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
    return <p className="self-center text-small text-destructive">No question has testimony from both parties, so there is nothing comparable to review. Retry failures or cancel.</p>
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
