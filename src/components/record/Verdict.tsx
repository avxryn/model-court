/**
 * The judgment: a summary on the record, and on the Judgment divider the
 * judge's form to enter or revise it, with earlier revisions folded away.
 */

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { Term, Stamp } from '@/components/court/CaseFile'
import { ChoiceCard, ChoiceCardGroup } from '@/components/court/ChoiceCard'
import { Fold } from '@/components/court/Fold'
import { JudgeSignature } from '@/components/court/JudgeSignature'
import { outcomeText } from '@/components/record/RecordGate'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { verdictSchema } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { codePointLength } from '@/domain/text'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { ResultsView } from '@/lib/dto'
import { formatDate, formatTime } from '@/lib/format'

/** The latest judgment on the record, with the way to the Judgment divider. */
export function JudgmentSummary({ data }: { data: ResultsView }) {
  const isOwner = data.role === 'owner'
  const latest = data.verdicts.at(-1)
  const judgmentPage = `/runs/${data.runId}/judgment`
  return (
    <section aria-labelledby="verdict" className="relative border-t border-border px-5 pt-6 pb-10 sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="verdict" className="court-label">
          <Term name="judgment" />
        </h2>
        {isOwner && (
          <Button size="sm" variant={latest ? 'ghost' : 'default'} render={<Link to={judgmentPage} />} nativeButton={false}>
            {latest ? 'Revise or print' : 'Enter judgment'} <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
      {latest ? (
        <div className="mt-3 space-y-2">
          <p className="font-display text-2xl leading-snug font-medium">{outcomeText(latest, data.configurations)}</p>
          <p className="max-w-3xl font-heading leading-relaxed whitespace-pre-wrap">{latest.rationale}</p>
          {latest.limitations && <p className="max-w-3xl text-sm whitespace-pre-wrap text-muted-foreground">Limitations: {latest.limitations}</p>}
          <div className="pt-4">
            <JudgeSignature note={`Entered ${formatTime(latest.createdAt)} · revision ${latest.revision}`} stamp={<Stamp kind="entered" detail={formatDate(latest.createdAt).toUpperCase()} />} />
          </div>
        </div>
      ) : (
        <p className="mt-2 font-heading text-base text-muted-foreground">{isOwner ? 'Enter your judgment on the Judgment divider, with the findings beside you. It may disagree with the numbers; say why.' : 'The judge has not entered judgment yet.'}</p>
      )}
    </section>
  )
}

export function EarlierRevisions({ verdicts }: { verdicts: ResultsView['verdicts'] }) {
  if (verdicts.length < 2) return null
  return (
    <Fold className="mt-4 print:hidden" summary={`Earlier revisions (${verdicts.length - 1})`}>
      <ol className="space-y-2 text-sm">
        {verdicts
          .slice(0, -1)
          .reverse()
          .map((v) => (
            <li key={v.revision} className="rounded-md bg-slip px-3 py-2">
              <span className="font-medium">
                Revision {v.revision}: {v.outcome}
              </span>{' '}
              — {v.rationale}
            </li>
          ))}
      </ol>
    </Fold>
  )
}

export function VerdictForm({ data, reload }: { data: ResultsView; reload: () => Promise<void> }) {
  const revising = data.verdicts.length > 0
  const [choice, setChoice] = useState<string>('')
  const [rationale, setRationale] = useState('')
  const [limitations, setLimitations] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intent = useRef(newIntentKey())
  const outcome = choice === 'tie' || choice === 'inconclusive' ? choice : choice ? 'selected' : ''
  const body = { outcome, ...(outcome === 'selected' ? { selectedConfigurationKey: choice } : {}), rationale: rationale.trim(), limitations: limitations.trim() }
  const valid = verdictSchema.safeParse(body).success
  const options = [...data.configurations.map((c) => ({ value: c.key, label: `Select ${c.label}` })), { value: 'tie', label: 'Tie' }, { value: 'inconclusive', label: 'Inconclusive' }]

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('POST', `/runs/${data.runId}/verdicts`, { body, revision: data.revision, idempotencyKey: intent.current })
      toast.success(revising ? 'Judgment revised' : 'Judgment entered')
      intent.current = newIntentKey()
      setChoice('')
      setRationale('')
      setLimitations('')
      await reload()
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.fields.length ? caught.fields.map((f) => f.message).join(' ') : describeError(caught))
      if (caught instanceof ApiClientError && caught.status !== 0) intent.current = newIntentKey()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      aria-labelledby="verdict-form-heading"
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h2 id="verdict-form-heading" className="text-base font-semibold">
        {revising ? 'Revise the judgment' : 'Enter judgment'}
      </h2>
      <ChoiceCardGroup aria-label="Decision" value={choice || null} onValueChange={setChoice} className="sm:grid-cols-2">
        {options.map((option) => (
          <ChoiceCard key={option.value} id={`verdict-${option.value}`} value={option.value} title={<span className="font-heading font-normal">{option.label}</span>} className="items-center" />
        ))}
      </ChoiceCardGroup>
      <Field className="gap-1.5">
        <FieldLabel htmlFor="verdict-rationale">Reasons</FieldLabel>
        <Textarea id="verdict-rationale" className="bg-exhibit font-heading" rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} aria-describedby="rationale-help" />
        <FieldDescription id="rationale-help" className="text-xs tabular-nums">
          {codePointLength(rationale.trim())}/{LIMITS.verdictRationale.max} · at least {LIMITS.verdictRationale.min} characters
        </FieldDescription>
      </Field>
      <Field className="gap-1.5">
        <FieldLabel htmlFor="verdict-limitations">Limitations (optional)</FieldLabel>
        <Textarea id="verdict-limitations" className="bg-exhibit font-heading" rows={2} value={limitations} onChange={(e) => setLimitations(e.target.value)} />
      </Field>
      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" disabled={!valid || busy}>
        {revising ? 'Enter revised judgment' : 'Enter judgment'}
      </Button>
    </form>
  )
}
