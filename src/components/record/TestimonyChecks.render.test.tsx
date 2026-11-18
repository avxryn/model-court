import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CheckResult } from '@/domain/kits/types'
import { TestimonyChecks } from './TestimonyChecks'

const labels = { 'label-format': 'Names one allowed label', 'label-correct': 'Matches the expected label', 'reasoning-given': 'Gives reasoning', boom: 'Boom' }
const results: CheckResult[] = [
  { checkId: 'label-format', status: 'pass', reason: 'Names Bug.', detail: {} },
  { checkId: 'label-correct', status: 'fail', reason: 'Said Bug; the expected label is Billing.', detail: {} },
  { checkId: 'reasoning-given', status: 'na', reason: 'The reasoning check is off for this case.', detail: {} },
  { checkId: 'boom', status: 'error', reason: 'This check could not run. That is a fault in Model Court, not in the answer.', detail: {} },
]

describe('TestimonyChecks', () => {
  it('names every status in words, never by colour alone, with the reason', () => {
    const html = renderToStaticMarkup(<TestimonyChecks results={results} labels={labels} party="Party A" />)
    for (const word of ['Passed', 'Failed', 'Does not apply', 'Could not run']) expect(html).toContain(word)
    expect(html).toContain('Said Bug; the expected label is Billing.')
    expect(html).toContain('aria-label="Automatic checks on Party A&#x27;s testimony"')
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(4)
  })

  it('escapes reasons as text', () => {
    const html = renderToStaticMarkup(<TestimonyChecks results={[{ checkId: 'x', status: 'fail', reason: '<img src=x onerror=alert(1)>', detail: {} }]} labels={{}} party="P" />)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('renders nothing without results', () => {
    expect(renderToStaticMarkup(<TestimonyChecks results={[]} labels={labels} party="P" />)).toBe('')
  })
})
