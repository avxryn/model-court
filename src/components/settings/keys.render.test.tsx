import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { quotaStanding } from '@/domain/quota'
import type { CredentialMetadata } from '@/lib/dto'
import { AllowanceRows, DailyAllowance } from './CallAllowance'
import { checkMessage, ProviderKeyCard } from './ProviderKeyCard'

const NOW = Date.UTC(2026, 10, 18, 15, 0, 0)
const key = (patch: Partial<CredentialMetadata> = {}): CredentialMetadata => ({
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'openai',
  label: 'Court key',
  status: 'active',
  revision: 1,
  createdAt: NOW,
  expiresAt: NOW + 7 * 86_400_000,
  lastUsedAt: null,
  lastUsedRunId: null,
  lastCheckedAt: null,
  lastCheckResult: null,
  ...patch,
})
const card = (current: CredentialMetadata | null) => renderToStaticMarkup(<ProviderKeyCard provider="openai" current={current} writesEnabled ttlDays={7} onChanged={async () => {}} />)

describe('ProviderKeyCard', () => {
  it('offers Check key for a saved key and says when it was never checked', () => {
    const html = card(key())
    expect(html).toContain('Check key')
    expect(html).toContain('Not checked yet')
  })

  it.each([
    ['valid', 'Key works'],
    ['invalid', 'Key rejected'],
    ['restricted', 'Key limited'],
    ['unreachable', 'Check incomplete'],
  ] as const)('shows the last %s check', (result, label) => {
    const html = card(key({ lastCheckedAt: NOW, lastCheckResult: result }))
    expect(html).toContain(label)
    expect(html).toContain('checked ')
  })

  it('has no Check key without a saved key', () => {
    expect(card(null)).not.toContain('Check key')
  })
})

describe('checkMessage', () => {
  it('never claims more than the list-models call proves', () => {
    expect(checkMessage('OpenAI', { result: 'valid', reason: 'OK' })).toBe('OpenAI accepted the key. Balance and model access are confirmed on the first call.')
    expect(checkMessage('OpenAI', { result: 'invalid', reason: 'AUTH_FAILED' })).toMatch(/rejected the key/)
    expect(checkMessage('Anthropic', { result: 'unreachable', reason: 'NETWORK_ERROR' })).toBe('Could not reach Anthropic to check the key. Try again shortly.')
    expect(checkMessage('Anthropic', { result: 'unreachable', reason: 'RATE_LIMITED' })).toMatch(/rate-limiting/)
  })
})

describe('call allowance', () => {
  const quota = quotaStanding({ dailyPerUser: 20, dailyGlobal: 100, lifetimeGlobal: 500 }, { userToday: 6, globalToday: 30, globalLifetime: 120 }, NOW)

  it('shows the judge’s remaining daily calls on the keys page', () => {
    const html = renderToStaticMarkup(<DailyAllowance quota={quota} />)
    expect(html).toContain('14 of 20')
    expect(html).toContain('provider calls left for you today')
  })

  it('shows the judge’s and the deployment’s remaining calls in the Start dialog', () => {
    const html = renderToStaticMarkup(
      <dl>
        <AllowanceRows quota={quota} />
      </dl>,
    )
    expect(html).toContain('Your calls left today')
    expect(html).toContain('14 of 20')
    expect(html).toContain('70 of 100 today · 380 of 500 in total')
  })
})
