/**
 * Settings → API keys (F26, spec §6.6, §7.2). The key lives only in this
 * component's memory until the save request; it is cleared on success,
 * cancel, and unmount, never autosaved, and never displayed again.
 */

import { useEffect, useRef, useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorPanel, formatTime, Page, PageHeader, PageSkeleton } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ProviderId } from '@/domain/registry'
import { PROVIDER_NAMES, PROVIDERS } from '@/domain/registry'
import { api, describeError, newIntentKey } from '@/lib/api-client'
import type { CatalogView, CredentialMetadata } from '@/lib/dto'
import { useApi } from '@/lib/use-api'

export default function ApiKeysPage() {
  const credentials = useApi<{ items: CredentialMetadata[] }>('/credentials')
  const catalog = useApi<CatalogView>('/catalog')

  return (
    <Page>
      <PageHeader
        eyebrow="Settings"
        title="Provider API keys"
        description="Live comparisons use your own OpenAI and Anthropic keys. Each generation is billed by the provider to your account. Invited reviewers never need a key."
      />
      <Alert className="mb-8">
        <ShieldCheck aria-hidden />
        <AlertTitle>How keys are stored</AlertTitle>
        <AlertDescription>
          Keys are encrypted with AES-256-GCM before they reach the database, can only be used by background generation for runs you start, and are never shown again.
          The deployment operator holds the encryption root, so encryption does not make keys inaccessible to that trusted operator. Prefer a purpose-specific key with provider-side spending limits.
        </AlertDescription>
      </Alert>
      <section aria-labelledby="key-hygiene" className="surface mb-8 p-5">
        <h2 id="key-hygiene" className="text-base font-semibold">
          Use a key you can afford to lose
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Create a dedicated Model Court–only key with a low monthly spend cap and access only to the model you are testing.</li>
          <li>Admin or organization keys are refused. Use an OpenAI project key or an Anthropic workspace key.</li>
          <li>
            Saved keys expire after {catalog.data?.limits.credentialTtlDays ?? 7} days unless you renew them. Expiry stops queued work exactly like removing the key.
          </li>
          <li>When you finish testing, remove the key here and rotate or delete it at the provider. Removing it here does not revoke it there.</li>
          <li>Turn on two-factor authentication for the GitHub or Google account you sign in with, and for your provider accounts.</li>
        </ul>
      </section>
      {credentials.loading && !credentials.data ? (
        <PageSkeleton label="Loading keys" />
      ) : credentials.error && !credentials.data ? (
        <ErrorPanel error={credentials.error} onRetry={credentials.reload} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {PROVIDERS.map((provider) => (
            <ProviderKeyCard
              key={provider}
              provider={provider}
              current={credentials.data?.items.find((item) => item.provider === provider) ?? null}
              writesEnabled={catalog.data?.credentialWritesEnabled ?? true}
              onChanged={credentials.reload}
            />
          ))}
        </div>
      )}
    </Page>
  )
}

function ProviderKeyCard({ provider, current, writesEnabled, onChanged }: { provider: ProviderId; current: CredentialMetadata | null; writesEnabled: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intent = useRef(newIntentKey())
  const name = PROVIDER_NAMES[provider]

  const reset = () => {
    setApiKey('')
    setLabel('')
    setConsent(false)
    setError(null)
    setEditing(false)
    intent.current = newIntentKey()
  }
  // Clear the secret from memory when navigating away.
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
      reset()
      toast.success(`${name} key saved. Access is checked on the first run.`)
      await onChanged()
    } catch (caught) {
      setError(describeError(caught))
      intent.current = newIntentKey()
    } finally {
      setBusy(false)
    }
  }

  const renew = async () => {
    if (!current) return
    setBusy(true)
    try {
      const renewed = await api<CredentialMetadata>('POST', `/credentials/${current.id}/renew`, { body: {}, revision: current.revision })
      toast.success(`${name} key renewed until ${formatTime(renewed.expiresAt)}`)
      await onChanged()
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!current) return
    setBusy(true)
    try {
      await api('DELETE', `/credentials/${current.id}`, { revision: current.revision })
      toast.success(`${name} key removed from Model Court`)
      await onChanged()
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  const keyId = `${provider}-api-key`
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-lg font-semibold">
          <span aria-hidden className="grid size-8 place-items-center rounded-full bg-secondary text-muted-foreground ring-1 ring-foreground/5">
            <KeyRound className="size-4" />
          </span>
          {name}
        </CardTitle>
        <CardDescription>
          {current ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Saved</Badge>
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
      {editing && (
        <CardContent>
          <form
            className="space-y-4"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${provider}-label`}>Label</Label>
              <Input id={`${provider}-label`} value={label} maxLength={60} placeholder={`${name} key`} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={keyId}>API key</Label>
              <Input
                id={keyId}
                type="password"
                value={apiKey}
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                aria-describedby={`${keyId}-help`}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p id={`${keyId}-help`} className="text-xs text-muted-foreground">
                Saving does not call {name}. Access and balance are checked on your first run.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id={`${provider}-consent`} checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} />
              <Label htmlFor={`${provider}-consent`} className="text-sm font-normal leading-snug">
                Store this key encrypted so background runs can use it after I close the browser. Runs I start will be billed to my {name} account.
              </Label>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              {current ? (
                <AlertDialog>
                  <AlertDialogTrigger render={<Button type="button" disabled={!apiKey.trim() || !consent || busy} />}>Replace key</AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Replace your {name} key?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The old key is removed from Model Court immediately. Runs that were pinned to it will not adopt the new key; unfinished work on them stops and needs a new run.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void save()}>Replace key</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button type="submit" disabled={!apiKey.trim() || !consent || busy}>
                  Save key
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      )}
      {!editing && (
        <CardFooter className="gap-2">
          <Button variant={current ? 'outline' : 'default'} disabled={!writesEnabled} onClick={() => setEditing(true)}>
            {current ? 'Replace key' : 'Add key'}
          </Button>
          {current && (
            <Button variant="outline" disabled={busy} onClick={() => void renew()}>
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
                    Queued generations that use it stop without sending anything. A request already in flight may still complete and be charged; its output will be rejected.
                    Responses already accepted stay as evidence. This does not revoke the key at {name} — rotate it there if it may be exposed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep key</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void remove()}>
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
