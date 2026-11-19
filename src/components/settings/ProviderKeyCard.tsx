/**
 * One provider's saved key (F26, spec §6.6, §7.2). The key lives only in this
 * component's memory until the save request; it is cleared on success,
 * cancel, and unmount, never autosaved, and never displayed again. The
 * advice on choosing a key sits in the form, where it is acted on.
 * "Check key" (D-57) asks the server to make the provider's free list-models
 * call with the stored key; only the result comes back.
 * Spec 07 §3.1, §8.2 (D-109): a key that clearly belongs to another company is refused here before
 * anything is sent (the server refuses it again), and the Google card says what Google keeps.
 */

import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Slip, SlipList } from '@/components/court/Paper'
import { StatusBadge } from '@/components/status/StatusBadge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { foreignKeyOwner, keyMismatchMessage } from '@/domain/contracts'
import { PROVIDER_NAMES, type ProviderId } from '@/domain/registry'
import { api, describeError, newIntentKey } from '@/lib/api-client'
import type { CredentialMetadata, KeyCheckView } from '@/lib/dto'
import { formatTime } from '@/lib/format'

type CheckResult = NonNullable<CredentialMetadata['lastCheckResult']>

const CHECK_BADGE: Record<CheckResult, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  valid: { label: 'Key works', tone: 'good' },
  restricted: { label: 'Key limited', tone: 'warn' },
  invalid: { label: 'Key rejected', tone: 'bad' },
  unreachable: { label: 'Check incomplete', tone: 'warn' },
}

/** What the check found, in words the judge can act on. Never provider text. */
export function checkMessage(name: string, view: Pick<KeyCheckView, 'result' | 'reason'>, provider?: ProviderId): string {
  switch (view.result) {
    case 'valid':
      return `${name} accepted the key. Balance and model access are confirmed on the first call.`
    case 'restricted':
      // Spec 07 §8.6: Google refuses an unrestricted or unverified project's key with 403.
      if (provider === 'google') return 'Google recognised this key but refused to list models. Make sure the key’s project has the Gemini API turned on and billing set up.'
      return `${name} recognised the key but would not list models with it. It may still work if it is limited to generation; if a hearing fails, replace it.`
    case 'invalid':
      return `${name} rejected the key. Replace it with a working key before you start a hearing.`
    case 'unreachable':
      return view.reason === 'RATE_LIMITED' ? `${name} is rate-limiting requests right now. Try the check again shortly.` : `Could not reach ${name} to check the key. Try again shortly.`
  }
}

export async function runKeyCheck(credentialId: string): Promise<KeyCheckView> {
  return api<KeyCheckView>('POST', `/credentials/${credentialId}/check`, { body: {} })
}

export function ProviderKeyCard({ provider, current, writesEnabled, ttlDays, onChanged }: { provider: ProviderId; current: CredentialMetadata | null; writesEnabled: boolean; ttlDays: number; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const name = PROVIDER_NAMES[provider]

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      toast.success(await fn())
      await onChanged()
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
    }
  }
  const renew = (key: CredentialMetadata) =>
    run(async () => {
      const renewed = await api<CredentialMetadata>('POST', `/credentials/${key.id}/renew`, { body: {}, revision: key.revision })
      return `${name} key renewed until ${formatTime(renewed.expiresAt)}`
    })
  const check = async (key: CredentialMetadata) => {
    setBusy(true)
    try {
      const view = await runKeyCheck(key.id)
      if (view.result === 'valid') toast.success(checkMessage(name, view, provider))
      else toast.warning(checkMessage(name, view, provider))
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
      await onChanged()
    }
  }
  const remove = (key: CredentialMetadata) =>
    run(async () => {
      await api('DELETE', `/credentials/${key.id}`, { revision: key.revision })
      return `${name} key removed from Model Court`
    })

  return (
    <Card className="paper rounded-sm ring-paper-edge">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-base font-semibold">
          <span aria-hidden className="grid size-8 place-items-center rounded-full bg-secondary text-muted-foreground ring-1 ring-foreground/5">
            <KeyRound className="size-4" />
          </span>
          {name}
        </CardTitle>
        <CardDescription>
          {current ? (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status="saved" label="Saved" tone="good" />
              <span>
                {current.label} · added {formatTime(current.createdAt)}
              </span>
              <span className="basis-full text-xs">
                Expires {formatTime(current.expiresAt)} · {current.lastUsedAt ? `last used ${formatTime(current.lastUsedAt)}` : 'not used yet'}
              </span>
              <span className="flex basis-full flex-wrap items-center gap-2 text-xs">
                {current.lastCheckResult && current.lastCheckedAt ? (
                  <>
                    <StatusBadge status={current.lastCheckResult} label={CHECK_BADGE[current.lastCheckResult].label} tone={CHECK_BADGE[current.lastCheckResult].tone} />
                    <span>checked {formatTime(current.lastCheckedAt)}</span>
                  </>
                ) : (
                  <span>Not checked yet</span>
                )}
              </span>
            </span>
          ) : (
            'No key saved. Needed to run comparisons that use this provider.'
          )}
        </CardDescription>
      </CardHeader>
      {provider === 'google' && (
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Gemini parties use your own Google AI Studio API key. Google bills your Google project. Model Court asks Google not to keep these requests in your project’s logs. Google still keeps a copy for a limited time to check for abuse.</p>
          <p className="rounded-sm bg-warning/10 p-2.5 text-foreground ring-1 ring-warning/25" data-testid="google-free-tier">
            On Google’s free tier, Google may use what you send to improve its products, and people at Google may read it. Use a paid-tier project for anything private. In the EEA, Switzerland or the UK, a paid-tier project is required.
          </p>
        </CardContent>
      )}
      {editing ? (
        <CardContent>
          <KeyForm
            provider={provider}
            current={current}
            ttlDays={ttlDays}
            onDone={async (saved) => {
              setEditing(false)
              if (saved) await onChanged()
            }}
          />
        </CardContent>
      ) : (
        <CardFooter className="flex-wrap gap-2">
          <Button variant={current ? 'outline' : 'default'} disabled={!writesEnabled} onClick={() => setEditing(true)}>
            {current ? 'Replace key' : 'Add key'}
          </Button>
          {current && (
            <Button variant="outline" disabled={busy} onClick={() => void check(current)}>
              Check key
            </Button>
          )}
          {current && (
            <Button variant="outline" disabled={busy} onClick={() => void renew(current)}>
              Renew
            </Button>
          )}
          {current && (
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="destructive" disabled={busy} />}>Remove</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove your {name} key?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Queued generations that use it stop without sending anything. A request already in flight may still complete and be charged; its output will be rejected. Responses already accepted stay as evidence. This does not revoke the key at {name} — rotate it there if it may be exposed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep key</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void remove(current)}>
                    Remove key
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!writesEnabled && <span className="text-xs text-muted-foreground">Adding keys is paused by the operator. Removal stays available.</span>}
        </CardFooter>
      )}
    </Card>
  )
}

function KeyForm({ provider, current, ttlDays, onDone }: { provider: ProviderId; current: CredentialMetadata | null; ttlDays: number; onDone: (saved: boolean) => Promise<void> }) {
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [consent, setConsent] = useState(false)
  const [checkAfterSave, setCheckAfterSave] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intent = useRef(newIntentKey())
  const name = PROVIDER_NAMES[provider]
  const keyId = `${provider}-api-key`
  // Spec 07 §8.2: refused before anything is sent, because Check key would send it to the wrong company.
  const owner = foreignKeyOwner(provider, apiKey.trim())
  const mismatch = owner ? keyMismatchMessage(owner) : null
  const ready = !!apiKey.trim() && consent && !busy && mismatch === null
  // Clear the secret from memory when the form closes or the page changes.
  useEffect(() => () => setApiKey(''), [])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const saved = await api<CredentialMetadata>('POST', '/credentials', {
        body: { provider, label: label.trim() || `${name} key`, apiKey, consentToStorage: true, ...(current ? { replacesCredentialId: current.id } : {}) },
        revision: current?.revision,
        idempotencyKey: intent.current,
      })
      setApiKey('')
      if (checkAfterSave) {
        // The key is already saved; a failed or negative check only changes the message.
        try {
          const view = await runKeyCheck(saved.id)
          if (view.result === 'valid') toast.success(`${name} key saved. ${checkMessage(name, view, provider)}`)
          else toast.warning(`${name} key saved. ${checkMessage(name, view, provider)}`)
        } catch (caught) {
          toast.warning(`${name} key saved, but it could not be checked: ${describeError(caught)}`)
        }
      } else {
        toast.success(`${name} key saved. Use Check key to test it before a hearing.`)
      }
      await onDone(true)
    } catch (caught) {
      setError(describeError(caught))
      intent.current = newIntentKey()
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-4"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault()
        if (!current && ready) void save()
      }}
    >
      <Slip title="Use a key you can afford to lose">
        <SlipList
          items={[
            ...(provider === 'google'
              ? ['Create the key in Google AI Studio and restrict it to the Gemini API. Use a project only for Model Court, with billing alerts set.']
              : ['A dedicated Model Court key with a low monthly spend cap and access only to the model you are testing.', 'Admin or organization keys are refused. Use an OpenAI project key or an Anthropic workspace key.']),
            `Saved keys expire after ${ttlDays} days unless you renew them. Expiry stops queued work exactly like removing the key.`,
          ]}
        />
      </Slip>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${provider}-label`}>Label</FieldLabel>
        <Input id={`${provider}-label`} value={label} maxLength={60} placeholder={`${name} key`} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={keyId}>API key</FieldLabel>
        <Input id={keyId} type="password" value={apiKey} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" aria-invalid={mismatch !== null || undefined} aria-describedby={mismatch ? `${keyId}-mismatch ${keyId}-help` : `${keyId}-help`} onChange={(e) => setApiKey(e.target.value)} />
        {mismatch && <FieldError id={`${keyId}-mismatch`}>{mismatch}</FieldError>}
        <FieldDescription id={`${keyId}-help`} className="text-xs">
          Saving alone does not contact {name}. Check key asks {name} to list its models with this key, which is free and generates nothing. Balance and model access are confirmed on the first hearing call.
        </FieldDescription>
      </Field>
      <Field orientation="horizontal" className="items-start">
        <Checkbox id={`${provider}-check`} checked={checkAfterSave} onCheckedChange={(checked) => setCheckAfterSave(checked === true)} />
        <FieldLabel htmlFor={`${provider}-check`} className="font-normal">
          Check the key with {name} after saving
        </FieldLabel>
      </Field>
      <Field orientation="horizontal" className="items-start">
        <Checkbox id={`${provider}-consent`} checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} />
        <FieldLabel htmlFor={`${provider}-consent`} className="font-normal">
          Store this key encrypted so background runs can use it after I close the browser. Runs I start will be billed to my {name} account.
        </FieldLabel>
      </Field>
      {error && <FieldError>{error}</FieldError>}
      <div className="flex gap-2">
        {current ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button type="button" disabled={!ready} />}>Replace key</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace your {name} key?</AlertDialogTitle>
                <AlertDialogDescription>The old key is removed from Model Court immediately. Unfinished work on hearings that use it stops; you can retry that work on the hearing page with the new key.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void save()}>Replace key</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button type="submit" disabled={!ready}>
            Save key
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setApiKey('')
            void onDone(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
