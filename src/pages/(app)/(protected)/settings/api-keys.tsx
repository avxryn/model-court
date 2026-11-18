/** Settings → API keys (F26, spec §6.6, §7.2): one card per provider, and how saved keys are kept. */

import { ShieldCheck } from 'lucide-react'
import { Fold } from '@/components/court/Fold'
import { Slip } from '@/components/court/Paper'
import { ErrorPanel } from '@/components/feedback/ErrorPanel'
import { PageSkeleton } from '@/components/feedback/PageSkeleton'
import { Page, PageHeader } from '@/components/layout/Page'
import { DailyAllowance } from '@/components/settings/CallAllowance'
import { ProviderKeyCard } from '@/components/settings/ProviderKeyCard'
import { PROVIDERS } from '@/domain/registry'
import type { CatalogView, CredentialMetadata, QuotaView } from '@/lib/dto'
import { useApi } from '@/lib/use-api'

export default function ApiKeysPage() {
  const credentials = useApi<{ items: CredentialMetadata[] }>('/credentials')
  const catalog = useApi<CatalogView>('/catalog')
  const quota = useApi<QuotaView>('/quota')

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Account' }, { label: 'Provider keys' }]}
        eyebrow="Account"
        title="Provider API keys"
        description="Live comparisons use your own OpenAI and Anthropic keys. Each generation is billed by the provider to your account. Jurors never need a key."
      />
      <div className="mb-4">
        <DailyAllowance quota={quota.data} />
      </div>
      {credentials.loading && !credentials.data ? (
        <PageSkeleton label="Loading keys" />
      ) : credentials.error && !credentials.data ? (
        <ErrorPanel error={credentials.error} onRetry={credentials.reload} />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {PROVIDERS.map((provider) => (
            <ProviderKeyCard
              key={provider}
              provider={provider}
              current={credentials.data?.items.find((item) => item.provider === provider) ?? null}
              writesEnabled={catalog.data?.credentialWritesEnabled ?? true}
              ttlDays={catalog.data?.limits.credentialTtlDays ?? 7}
              onChanged={credentials.reload}
            />
          ))}
        </div>
      )}
      <Slip aria-labelledby="key-storage" className="mt-8 max-w-2xl" title={<span id="key-storage">How keys are stored</span>} icon={<ShieldCheck className="size-4 text-muted-foreground" aria-hidden />}>
        <p>
          Keys are encrypted with AES-256-GCM before they reach the database, can only be used by background generation for runs you start, and are never shown again. When you finish testing, remove the key here and rotate or delete it at the provider: removing it here does not revoke it there.
        </p>
        <Fold className="mt-2" summary="Who else could reach a saved key">
          <p>
            The deployment operator holds the encryption root, so encryption does not make keys inaccessible to that trusted operator. Prefer a purpose-specific key with provider-side spending limits, and turn on two-factor authentication for the GitHub or Google account you sign in with and for your provider accounts.
          </p>
        </Fold>
      </Slip>
    </Page>
  )
}
