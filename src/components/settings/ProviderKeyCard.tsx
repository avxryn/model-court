/**
 * One provider's saved key (F26, spec §6.6, §7.2). The key lives only in this
 * component's memory until the save request; it is cleared on success,
 * cancel, and unmount, never autosaved, and never displayed again. The
 * advice on choosing a key sits in the form, where it is acted on.
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
import { PROVIDER_NAMES, type ProviderId } from '@/domain/registry'
import { api, describeError, newIntentKey } from '@/lib/api-client'
import type { CredentialMetadata } from '@/lib/dto'
import { formatTime } from '@/lib/format'

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
            </span>
          ) : (
            'No key saved. Needed to run comparisons that use this provider.'
          )}
        </CardDescription>
      </CardHeader>
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intent = useRef(newIntentKey())
  const name = PROVIDER_NAMES[provider]
  const keyId = `${provider}-api-key`
  const ready = !!apiKey.trim() && consent && !busy
  // Clear the secret from memory when the form closes or the page changes.
  useEffect(() => () => setApiKey(''), [])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('POST', '/credentials', {
        body: { provider, label: label.trim() || `${name} key`, apiKey, consentToStorage: true, ...(current ? { replacesCredentialId: current.id } : {}) },
        revision: current?.revision,
        idempotencyKey: intent.current,
      })
      setApiKey('')
      toast.success(`${name} key saved. Access is checked on the first run.`)
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
            'A dedicated Model Court key with a low monthly spend cap and access only to the model you are testing.',
            'Admin or organization keys are refused. Use an OpenAI project key or an Anthropic workspace key.',
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
        <Input id={keyId} type="password" value={apiKey} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" aria-describedby={`${keyId}-help`} onChange={(e) => setApiKey(e.target.value)} />
        <FieldDescription id={`${keyId}-help`} className="text-xs">
          Saving does not call {name}. Access and balance are checked on your first run.
        </FieldDescription>
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
                <AlertDialogDescription>The old key is removed from Model Court immediately. Runs that were pinned to it will not adopt the new key; unfinished work on them stops and needs a new run.</AlertDialogDescription>
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
