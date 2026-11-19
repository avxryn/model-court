import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { checkMessage, ProviderKeyCard } from './ProviderKeyCard'

const card = (provider: 'openai' | 'anthropic' | 'google') => renderToStaticMarkup(<ProviderKeyCard provider={provider} current={null} writesEnabled ttlDays={7} onChanged={async () => {}} />)

describe('ProviderKeyCard (spec 07 §3.1, §8.6)', () => {
  it('shows a Google card with what Google keeps and the free-tier warning', () => {
    const html = card('google')
    expect(html).toContain('Google')
    expect(html).toContain('Gemini parties use your own Google AI Studio API key.')
    expect(html).toContain('Model Court asks Google not to keep these requests in your project’s logs.')
    expect(html).toContain('data-testid="google-free-tier"')
    expect(html).toContain('In the EEA, Switzerland or the UK, a paid-tier project is required.')
  })

  it('keeps the OpenAI and Anthropic cards free of Google copy', () => {
    for (const provider of ['openai', 'anthropic'] as const) expect(card(provider)).not.toContain('google-free-tier')
  })

  it('says what a restricted Google key means, in Google’s terms', () => {
    expect(checkMessage('Google', { result: 'restricted', reason: 'ACCESS_DENIED' }, 'google')).toBe('Google recognised this key but refused to list models. Make sure the key’s project has the Gemini API turned on and billing set up.')
    expect(checkMessage('OpenAI', { result: 'restricted', reason: 'ACCESS_DENIED' }, 'openai')).toContain('may still work')
  })
})
