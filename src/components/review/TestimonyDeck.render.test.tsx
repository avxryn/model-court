import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TestimonyDeck } from './TestimonyDeck'

const items = ['A', 'B', 'C', 'D', 'E'].map((label, i) => ({ key: `r${i}`, label, done: i < 2, node: <article data-testimony>{`Answer ${label}`}</article> }))

describe('TestimonyDeck (spec 07 §9.2)', () => {
  it('shows tabs A–E with scored ticks, one testimony, and Compare two', () => {
    const html = renderToStaticMarkup(<TestimonyDeck items={items} />)
    for (const label of ['A', 'B', 'C', 'D', 'E']) expect(html).toContain(`<span class="sr-only">Testimony </span>${label}`)
    expect(html.match(/aria-label="scored"/g)).toHaveLength(2)
    expect(html).toContain('Answer A')
    expect(html).not.toContain('Answer B')
    expect(html).toContain('Compare two')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('2 of 5 scored.')
    expect(html).toContain('role="tablist"')
  })

  it('names parties on the record and drops the keys there', () => {
    const html = renderToStaticMarkup(<TestimonyDeck noun="Party" keys={false} items={items.map((item) => ({ ...item, done: undefined, label: `Setup ${item.label}` }))} />)
    expect(html).toContain('<span class="sr-only">Party </span>Setup A')
    expect(html).not.toContain('scored')
    expect(html).not.toContain('<kbd')
  })
})
