import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AllowanceRows } from '@/components/settings/CallAllowance'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import type { DraftInput } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { plannedCalls, quotaBlock, repeatHint } from '@/domain/quota'
import { PROVIDER_NAMES, type ProviderId } from '@/domain/registry'
import { generatedParties } from '@/domain/snapshot'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { CredentialMetadata, QuotaView } from '@/lib/dto'
import { draftKit } from '@/lib/kits'
import { useApi } from '@/lib/use-api'

/** Freeze the saved draft into a hearing; consent to provider processing and charges when anything is generated. */
export function StartHearingDialog({ evaluationId, revision, draft, providers, keys, disabled }: { evaluationId: string; revision: number; draft: DraftInput; providers: ProviderId[]; keys: CredentialMetadata[]; disabled: boolean }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const [charges, setCharges] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intent = useRef(newIntentKey())
  const modelParties = generatedParties(draft.configurations).length
  const samples = modelParties > 0 ? (draft.samplesPerAnswer ?? 1) : 1
  const calls = plannedCalls(draft)
  const kit = draftKit(draft)
  // Imported-only hearings send nothing to a provider and charge nothing, so there is nothing to consent to.
  const needsConsent = calls > 0
  const providerNames = providers.map((p) => PROVIDER_NAMES[p]).join(' and ')
  // D-57: show what is left of the call caps, and refuse a hearing that cannot fit. The server enforces them too.
  const quota = useApi<QuotaView>(open && needsConsent ? '/quota' : null)
  const block = quota.data ? quotaBlock(calls, quota.data) : null
  const hint = quota.data ? repeatHint(draft, quota.data) : null

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const credentialIdsByProvider = Object.fromEntries(providers.map((provider) => [provider, keys.find((k) => k.provider === provider)?.id]))
      const result = await api<{ runId: string }>('POST', `/evaluations/${evaluationId}/runs`, {
        body: { draftRevision: revision, credentialIdsByProvider, consentToProviderProcessing: true, acknowledgeProviderCharges: true },
        idempotencyKey: intent.current,
      })
      setOpen(false)
      navigate(`/runs/${result.runId}`)
    } catch (caught) {
      setError(describeError(caught))
      if (!(caught instanceof ApiClientError && caught.status === 0)) intent.current = newIntentKey()
      if (caught instanceof ApiClientError && caught.code === 'QUOTA_EXHAUSTED') void quota.reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setConsent(false)
          setCharges(false)
          setError(null)
          intent.current = newIntentKey()
        }
      }}
    >
      <DialogTrigger render={<Button disabled={disabled} aria-label="Start a hearing" />}>
        <Play aria-hidden /> Start<span className="hidden sm:inline"> a hearing</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-medium">Start a hearing</DialogTitle>
          <DialogDescription>
            {needsConsent
              ? `This freezes the saved draft into an unchangeable hearing (a run) and sends one request per question and model party${samples > 1 ? `, ${samples} times each (repeats)` : ''}, using your own provider keys.${modelParties < draft.configurations.length ? ' Imported answers are not sent.' : ''}`
              : 'This freezes the saved draft into an unchangeable hearing (a run). Every party has imported answers, so nothing is generated.'}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Planned calls</dt>
          <dd className="tabular-nums">
            {needsConsent ? (
              <>
                {draft.cases.length} questions × {modelParties} model {modelParties === 1 ? 'party' : 'parties'}
                {samples > 1 && <> × {samples} samples</>} = <strong>{calls}</strong>
              </>
            ) : (
              <strong>None</strong>
            )}
          </dd>
          {needsConsent && (
            <>
              <dt className="text-muted-foreground">Providers</dt>
              <dd>{providerNames}</dd>
              <dt className="text-muted-foreground">Output limit</dt>
              <dd>{LIMITS.maxOutputTokens} tokens per response</dd>
              {quota.data ? (
                <AllowanceRows quota={quota.data} />
              ) : (
                <>
                  <dt className="text-muted-foreground">Calls left</dt>
                  <dd className="text-muted-foreground">{quota.error ? 'Could not load the call limits. They are still checked when you start.' : 'Loading…'}</dd>
                </>
              )}
            </>
          )}
        </dl>
        {kit.checks.length > 0 && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            After each answer arrives, Model Court runs these free checks on its own server: {kit.checks.map((check) => check.label).join(', ')}. Nothing extra is sent to a provider and nothing is charged. Results stay sealed until you unseal the record.
          </p>
        )}
        {block && (
          <p className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" role="alert" id="start-blocked">
            {block.message}
            {hint && <span className="mt-1 block">{hint}</span>}
          </p>
        )}
        {needsConsent ? (
          <div className="space-y-3 rounded-md bg-slip p-4">
            <Field orientation="horizontal" className="items-start">
              <Checkbox id="consent-processing" checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
              <FieldLabel htmlFor="consent-processing" className="font-normal">
                Send each question, its exhibit, and the system instructions to {providerNames}. Scoring guides, ratings, and identities stay in Model Court.
              </FieldLabel>
            </Field>
            <Field orientation="horizontal" className="items-start">
              <Checkbox id="consent-charges" checked={charges} onCheckedChange={(c) => setCharges(c === true)} />
              <FieldLabel htmlFor="consent-charges" className="font-normal">
                Charge my provider accounts for these {calls} calls. A timed-out request may be charged even without a response, and a retry of it can be charged again.
              </FieldLabel>
            </Field>
          </div>
        ) : (
          <p className="rounded-md bg-slip p-4 text-sm">Only imported answers: nothing is sent to an AI provider and nothing is charged. Jurors review the answers as you saved them.</p>
        )}
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <Button disabled={(needsConsent && (!consent || !charges || block !== null)) || busy} aria-describedby={block ? 'start-blocked' : undefined} onClick={() => void start()}>
            {busy ? 'Starting…' : calls > 0 ? `Start ${calls} calls` : 'Start the hearing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
