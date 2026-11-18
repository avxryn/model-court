import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import type { DraftInput } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { PROVIDER_NAMES, type ProviderId } from '@/domain/registry'
import { generatedParties } from '@/domain/snapshot'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { CredentialMetadata } from '@/lib/dto'

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
  const calls = draft.cases.length * modelParties
  // Imported-only hearings send nothing to a provider and charge nothing, so there is nothing to consent to.
  const needsConsent = calls > 0
  const providerNames = providers.map((p) => PROVIDER_NAMES[p]).join(' and ')

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
              ? `This freezes the saved draft into an unchangeable hearing (a run) and sends one request per question and model party, using your own provider keys.${modelParties < draft.configurations.length ? ' Imported answers are not sent.' : ''}`
              : 'This freezes the saved draft into an unchangeable hearing (a run). Every party has imported answers, so nothing is generated.'}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Planned calls</dt>
          <dd className="tabular-nums">
            {needsConsent ? (
              <>
                {draft.cases.length} questions × {modelParties} model {modelParties === 1 ? 'party' : 'parties'} = <strong>{calls}</strong>
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
            </>
          )}
        </dl>
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
          <Button disabled={(needsConsent && (!consent || !charges)) || busy} onClick={() => void start()}>
            {busy ? 'Starting…' : calls > 0 ? `Start ${calls} calls` : 'Start the hearing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
