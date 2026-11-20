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
import { callsPerAnswer, plannedCalls, plannedCallsAreUpperBound, quotaBlock, repeatHint } from '@/domain/quota'
import { PROVIDER_NAMES, type ProviderId } from '@/domain/registry'
import { generatedParties } from '@/domain/snapshot'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { CredentialMetadata, QuotaView } from '@/lib/dto'
import { estimateExtractionInput } from '@/domain/extraction/estimate'
import { estimateGroundedInput } from '@/domain/grounded/estimate'
import { draftKit } from '@/lib/kits'
import { useApi } from '@/lib/use-api'

/** Freeze the saved draft into a hearing; consent to provider processing and charges when anything is generated. */
export interface StartScenario {
  /** The saved draft's scenario hash, sent so a draft changed in another tab is refused (D-69). */
  hash: string | null
  /** "hearings 1 and 2 (v1)" when the questions match earlier hearings. */
  sameAs: string | null
  nextVersion: number
  /** Calls for parties already heard in that hearing versus new ones. */
  split: { heardIn: number; again: number; fresh: number; freshLabels: string[] } | null
}

export function StartHearingDialog({ evaluationId, revision, draft, providers, keys, disabled, scenario }: { evaluationId: string; revision: number; draft: DraftInput; providers: ProviderId[]; keys: CredentialMetadata[]; disabled: boolean; scenario?: StartScenario }) {
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
  // Spec 06 §3 (D-103): a tool hearing's calls are a cap (each answer may use up to its question's step cap).
  const upTo = plannedCallsAreUpperBound(draft)
  const caps = [...new Set(draft.cases.map((testCase) => callsPerAnswer(testCase)))].sort((a, b) => a - b)
  const kit = draftKit(draft)
  // Spec 04 §3.1 (D-90): a PDF file sent to the providers needs its own tick.
  const pdf = estimateExtractionInput(draft.cases, draft.configurations, samples).pdfPages
  const [sendsDocuments, setSendsDocuments] = useState(false)
  // Imported-only hearings send nothing to a provider and charge nothing, so there is nothing to consent to.
  const needsConsent = calls > 0
  const providerNames = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(providers.map((p) => PROVIDER_NAMES[p]))
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
        body: { draftRevision: revision, credentialIdsByProvider, consentToProviderProcessing: true, acknowledgeProviderCharges: true, ...(pdf > 0 ? { acknowledgeSendsDocuments: true } : {}), ...(scenario?.hash ? { expectedScenarioHash: scenario.hash } : {}) },
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
          <DialogTitle>Start a hearing</DialogTitle>
          <DialogDescription>
            {needsConsent
              ? `This freezes the saved draft into an unchangeable hearing (a run) and sends one request per question and model party${samples > 1 ? `, ${samples} times each (repeats)` : ''}, using your own provider keys.${modelParties < draft.configurations.length ? ' Imported answers are not sent.' : ''}`
              : 'This freezes the saved draft into an unchangeable hearing (a run). Every party has imported answers, so nothing is generated.'}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
          {scenario && (
            <>
              <dt className="text-muted-foreground">Questions</dt>
              <dd>{scenario.sameAs ? `Same questions as ${scenario.sameAs}` : `New questions: this hearing starts v${scenario.nextVersion}`}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Planned calls</dt>
          <dd className="tabular-nums">
            {needsConsent && upTo ? (
              <>
                Up to <strong>{calls}</strong>: {modelParties} model {modelParties === 1 ? 'party' : 'parties'} × {draft.cases.length} {draft.cases.length === 1 ? 'question' : 'questions'}
                {samples > 1 && <> × {samples} samples</>} × up to {caps.length === 1 ? caps[0] : `${caps[0]}–${caps.at(-1)}`} calls each
              </>
            ) : needsConsent ? (
              <>
                {draft.cases.length} questions × {modelParties} model {modelParties === 1 ? 'party' : 'parties'}
                {samples > 1 && <> × {samples} samples</>} = <strong>{calls}</strong>
              </>
            ) : (
              <strong>None</strong>
            )}
          </dd>
          <dt className="text-muted-foreground">Juror workload</dt>
          <dd className="tabular-nums" data-testid="juror-workload">
            Each juror will score {draft.configurations.length * draft.cases.length} answers ({draft.configurations.length} parties on {draft.cases.length} {draft.cases.length === 1 ? 'question' : 'questions'})
          </dd>
          {needsConsent && scenario?.split && (
            <>
              <dt className="text-muted-foreground">Of these</dt>
              <dd>
                {scenario.split.fresh > 0 && <>{scenario.split.fresh} for {scenario.split.freshLabels.join(' and ')} (new); </>}
                {scenario.split.again} for parties already heard in hearing {scenario.split.heardIn} (asked again, answers may differ). That is what lets you compare the hearings fairly.
              </dd>
            </>
          )}
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
        {kit.family === 'extraction' && <ExtractionSendsLine draft={draft} samples={samples} />}
        {kit.family === 'grounded' && needsConsent && <GroundedSendsLine draft={draft} samples={samples} />}
        {kit.family === 'tools' && needsConsent && (
          <div className="space-y-1.5 text-small leading-relaxed text-muted-foreground">
            <p>
              Each call sends the question, its context, the system instructions and the tools (names, descriptions, argument schemas), then every earlier step of that answer with the canned results of the calls the party made. The rest of your response table and the expectations stay in Model Court. Nothing real is run.
            </p>
            <p>Calls a party does not need are returned to your daily allowance when it finishes. Every step resends the conversation so far, so input tokens grow with each step.</p>
          </div>
        )}
        {kit.checks.length > 0 && (
          <p className="text-small leading-relaxed text-muted-foreground">
            After each answer arrives, Model Court runs these free checks on its own server: {kit.checks.map((check) => check.label).join(', ')}. Nothing extra is sent to a provider and nothing is charged. Results stay sealed until you unseal the record.
          </p>
        )}
        {block && (
          <p className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-small text-destructive" role="alert" id="start-blocked">
            {block.message}
            {hint && <span className="mt-1 block">{hint}</span>}
          </p>
        )}
        {needsConsent ? (
          <div className="space-y-3 rounded-md bg-slip p-4">
            <Field orientation="horizontal" className="items-start">
              <Checkbox id="consent-processing" checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
              <FieldLabel htmlFor="consent-processing" className="font-normal">
                {kit.family === 'grounded'
                  ? `Send each question, its sources, and the system instructions to ${providerNames}. Your notes on the sources, the grounding key, scoring guides, ratings, and identities stay in Model Court.`
                  : kit.family === 'tools'
                  ? `Send each question, its context, the system instructions, the tools, and the canned results of the calls each party makes to ${providerNames}. The rest of your response table, the expectations, scoring guides, ratings, and identities stay in Model Court.`
                  : `Send each question, its exhibit, and the system instructions to ${providerNames}. Scoring guides, ratings, and identities stay in Model Court.`}
              </FieldLabel>
            </Field>
            {providers.includes('google') && (
              <p className="text-caption text-muted-foreground" data-testid="google-consent-note">
                Google: if your key’s project is on the free tier, Google may use this content to improve its products.
              </p>
            )}
            {pdf > 0 && (
              <Field orientation="horizontal" className="items-start">
                <Checkbox id="consent-documents" checked={sendsDocuments} onCheckedChange={(c) => setSendsDocuments(c === true)} />
                <FieldLabel htmlFor="consent-documents" className="font-normal">
                  Each call sends the PDF file itself to {providerNames} ({pdf} {pdf === 1 ? 'page' : 'pages'} in all). The provider reads its text and an image of each page.
                </FieldLabel>
              </Field>
            )}
            <Field orientation="horizontal" className="items-start">
              <Checkbox id="consent-charges" checked={charges} onCheckedChange={(c) => setCharges(c === true)} />
              <FieldLabel htmlFor="consent-charges" className="font-normal">
                Charge my provider accounts for {upTo ? `up to ${calls}` : `these ${calls}`} calls. A timed-out request may be charged even without a response, and a retry of it can be charged again.
              </FieldLabel>
            </Field>
          </div>
        ) : (
          <p className="rounded-md bg-slip p-4 text-small">Only imported answers: nothing is sent to an AI provider and nothing is charged. Jurors review the answers as you saved them.</p>
        )}
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <Button disabled={(needsConsent && (!consent || !charges || block !== null || (pdf > 0 && !sendsDocuments))) || busy} aria-describedby={block ? 'start-blocked' : undefined} onClick={() => void start()}>
            {busy ? 'Starting…' : calls > 0 ? `Start ${upTo ? 'up to ' : ''}${calls} calls` : 'Start the hearing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Spec 05 §3, §10 (D-95): what each grounded call sends, and an input-token estimate. */
function GroundedSendsLine({ draft, samples }: { draft: DraftInput; samples: number }) {
  const estimate = estimateGroundedInput(draft.cases, draft.configurations, samples)
  return (
    <div className="space-y-1.5 text-small leading-relaxed text-muted-foreground">
      <p>Each call sends the party’s instructions, the question’s sources in your order, the request, and the citation format. Your notes, the grounding key and the jury instructions are never sent.</p>
      <p className="tabular-nums">
        About {estimate.total.toLocaleString('en-US')} input tokens across {estimate.calls} {estimate.calls === 1 ? 'call' : 'calls'}, billed to your keys. This is an estimate. Sources are sent with every call, so long sources cost more on every party.
      </p>
    </div>
  )
}

/** Spec 04 §3.1, §10.3: what each extraction call sends, and an input-token estimate. */
function ExtractionSendsLine({ draft, samples }: { draft: DraftInput; samples: number }) {
  const estimate = estimateExtractionInput(draft.cases, draft.configurations, samples)
  const largest = Math.max(0, ...estimate.perCall.map((call) => call.tokens))
  return (
    <div className="space-y-1.5 text-small leading-relaxed text-muted-foreground">
      <p>Each call sends the party’s instructions, the document, your request and the field list. Your answer keys and jury instructions are never sent.</p>
      <p className="tabular-nums">
        Estimate: up to about {largest.toLocaleString('en-US')} input tokens a call, {estimate.total.toLocaleString('en-US')} in total. Output tokens, reasoning and retries add to it, billed to your keys.
      </p>
    </div>
  )
}
