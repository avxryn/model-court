import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PROVIDER_NAMES, type ProviderId } from '@/domain/registry'
import type { CredentialMetadata } from '@/lib/dto'

/**
 * The keys this comparison needs. A missing key is an alert at the top of
 * the Parties divider; once every key is saved it is one line under the parties.
 */
export function MissingKeys({ missing }: { missing: ProviderId[] }) {
  if (missing.length === 0) return null
  const names = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(missing.map((p) => PROVIDER_NAMES[p]))
  return (
    <Alert className="mb-6 bg-slip">
      <KeyRound aria-hidden />
      <AlertTitle>Add your {names} {missing.length === 1 ? 'key' : 'keys'} to start a hearing</AlertTitle>
      <AlertDescription>Comparing two models from the same provider needs only one key. Jurors never need keys.</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" render={<Link to="/settings/api-keys" />} nativeButton={false}>
          Add a key
        </Button>
      </AlertAction>
    </Alert>
  )
}

export function SavedKeys({ providers, keys }: { providers: ProviderId[]; keys: CredentialMetadata[] }) {
  const saved = providers.flatMap((provider) => {
    const key = keys.find((k) => k.provider === provider)
    return key ? [`${PROVIDER_NAMES[provider]} (${key.label})`] : []
  })
  if (saved.length === 0 || saved.length < providers.length) return null
  return (
    <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
      <KeyRound className="size-3.5" aria-hidden /> Keys saved: {saved.join(' · ')}. Jurors never need keys.{' '}
      <Link to="/settings/api-keys" className="underline underline-offset-4 hover:text-foreground">
        Manage keys
      </Link>
    </p>
  )
}
