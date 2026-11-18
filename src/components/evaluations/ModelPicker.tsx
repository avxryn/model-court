/**
 * The model picker for a party or the special master (D-48): catalog routes grouped by
 * provider, with the facts a judge needs to compare them. Only live-checked routes are listed
 * by default, since a hearing refuses the rest (D-52); a toggle under the picker shows them for
 * planning, and a route already chosen always stays listed.
 */

import { useState, type ReactNode } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LIMITS } from '@/domain/limits'
import { PROVIDER_NAMES, routesByProvider } from '@/domain/registry'
import type { CatalogModel } from '@/lib/dto'
import { cn } from '@/lib/utils'

/** 1_050_000 → "1.05M", 400_000 → "400K". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(2))}M`
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}K`
  return String(tokens)
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** "OpenAI GPT-6.2 Astra" for the closed trigger, where the group heading is not visible. */
export function modelTitle(model: Pick<CatalogModel, 'provider' | 'label'>): string {
  return `${PROVIDER_NAMES[model.provider]} ${model.label}`
}

export function ModelSelect({
  id,
  models,
  value,
  onChange,
  className,
  disabledKeys,
}: {
  id: string
  models: readonly CatalogModel[]
  value: string | null
  onChange: (key: string) => void
  className?: string
  /** Keys that cannot be picked here (for example, a model another party already uses in a model comparison). */
  disabledKeys?: ReadonlySet<string>
}) {
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = models.filter((m) => !m.enabled && m.key !== value).length
  const visible = showAll ? models : models.filter((m) => m.enabled || m.key === value)
  const counts = new Map(routesByProvider(models).map((g) => [g.provider, { checked: g.routes.filter((m) => m.enabled).length, total: g.routes.length }]))
  const groups = routesByProvider(visible).filter((g) => g.routes.length > 0)
  return (
    <div className="space-y-1">
      <Select value={value || null} onValueChange={(next) => onChange(String(next))} items={models.map((m) => ({ value: m.key, label: modelTitle(m) }))}>
        <SelectTrigger id={id} className={cn('w-full', className)}>
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="min-w-72">
          {groups.map((group, index) => (
            <SelectGroup key={group.provider}>
              {index > 0 && <SelectSeparator />}
              <SelectLabel className="flex items-baseline justify-between gap-2 pt-2">
                <span className="court-label">{PROVIDER_NAMES[group.provider]}</span>
                <span className="text-[0.6875rem]">
                  {counts.get(group.provider)?.checked} of {counts.get(group.provider)?.total} live-checked
                </span>
              </SelectLabel>
              {group.routes.map((model) => (
                <SelectItem key={model.key} value={model.key} disabled={disabledKeys?.has(model.key)}>
                  <span className="min-w-0 flex-1 truncate">{model.label}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {disabledKeys?.has(model.key) && <span>in use</span>}
                    {model.reasoning === 'low' && <span>reasons</span>}
                    <span className="tabular-nums">{formatTokens(model.contextTokens)}</span>
                    {model.enabled && (
                      <Badge variant="secondary" className="h-4 px-1.5 text-[0.625rem]">
                        <Check aria-hidden />
                        checked
                      </Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {(hiddenCount > 0 || showAll) && (
        <button type="button" onClick={() => setShowAll((v) => !v)} aria-pressed={showAll} className="rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          {showAll ? 'Hide models not yet live-checked' : `Show ${hiddenCount} more not yet live-checked (a hearing can’t use them yet)`}
        </button>
      )}
    </div>
  )
}

/** What this choice means for the hearing: identity, limits, reasoning, live checks. */
export function ModelFacts({ model, needsConversation, className }: { model: CatalogModel | undefined; needsConversation?: boolean; className?: string }) {
  if (!model) return <p className={cn('text-xs text-muted-foreground', className)}>Answers are capped at {LIMITS.maxOutputTokens} tokens. No tools, browsing, or streaming.</p>
  const sentCap = model.reasoning === 'low' ? LIMITS.maxOutputTokens + LIMITS.reasoningHeadroomTokens : LIMITS.maxOutputTokens
  const rows: Array<[string, ReactNode]> = [
    [
      'Model',
      <>
        {PROVIDER_NAMES[model.provider]} · <span className="typewriter">{model.modelId}</span>
      </>,
    ],
    ['Context', `${formatTokens(model.contextTokens)} tokens; the provider allows up to ${formatTokens(model.providerMaxOutputTokens)} output tokens`],
    [
      'Reasoning',
      model.reasoning === 'low'
        ? `Always on (the model can’t turn it off). Sent at low effort with ${sentCap.toLocaleString()} output tokens; reasoning is billed as output, and the answer may run past ${LIMITS.maxOutputTokens} tokens.`
        : `Off. The ${LIMITS.maxOutputTokens}-token limit is all answer.`,
    ],
    [
      'Live check',
      model.enabled ? (
        `Passed ${formatDate(model.verifiedAt!)}.`
      ) : (
        <span className="text-warning">Not run yet. A hearing can’t start until a live call is recorded for this model.</span>
      ),
    ],
  ]
  if (needsConversation !== undefined || model.multiTurnVerifiedAt) {
    rows.push([
      'Conversations',
      model.multiTurnVerifiedAt ? (
        `Passed ${formatDate(model.multiTurnVerifiedAt)}.`
      ) : (
        <span className={cn(needsConversation && 'text-warning')}>Not checked yet{needsConversation ? '; a question here has a conversation, so this model can’t run it yet.' : '.'}</span>
      ),
    ])
  }
  if (model.retiresNotBefore) rows.push(['Retirement', `The provider may retire it from ${formatDate(model.retiresNotBefore)}.`])

  return (
    <div className={cn('@container space-y-1.5 text-xs', className)}>
      {/* Term beside detail when the card is wide enough; stacked in a narrow three-party row. */}
      <dl className="grid gap-x-3 leading-snug @[20rem]:grid-cols-[max-content_1fr] @[20rem]:gap-y-1">
        {rows.map(([term, detail]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="mb-1.5 text-foreground @[20rem]:mb-0">{detail}</dd>
          </div>
        ))}
      </dl>
      <a href={model.docsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        {PROVIDER_NAMES[model.provider]} model documentation <ExternalLink aria-hidden className="size-3" />
      </a>
    </div>
  )
}
