import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KitPicker } from '@/components/evaluations/KitPicker'
import { KitFacts } from '@/components/review/KitFacts'
import { draftInputSchema, type DraftInput } from '@/domain/contracts'
import { makeExampleDraft } from '@/domain/example'
import { CASE_TEMPLATES } from './templates'
import { switchKit } from './kits'

const newId = () => crypto.randomUUID()
const seed = () => makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
const history = [
  { role: 'user' as const, content: 'a' },
  { role: 'assistant' as const, content: 'b' },
]

describe('switchKit', () => {
  it('sets the kit, its default settings and its default rubric, and keeps the draft valid', () => {
    const { draft, removals } = switchKit(seed(), 'summarization-v1')
    expect(removals).toEqual([])
    expect(draft).toMatchObject({ kit: { version: 'summarization-v1', settings: { lengthUnit: 'words', maxLength: 100 } }, rubricVersion: 'summary-v1' })
    expect(draftInputSchema.safeParse(draft).success).toBe(true)
  })

  it('switching to field extraction clears exhibits and says so, keeping the draft valid', () => {
    const { draft, removals } = switchKit(seed(), 'extraction-v1')
    expect(removals).toEqual([expect.stringContaining('clears the exhibit of 5 questions')])
    expect(draft.cases.every((testCase) => testCase.reference === '')).toBe(true)
    expect(draft).toMatchObject({ kit: { version: 'extraction-v1' }, rubricVersion: 'extraction-v1' })
    expect(draftInputSchema.safeParse(draft).success).toBe(true)
  })

  it('keeps a rubric the judge chose, but follows the kit when the rubric was the previous default', () => {
    expect(switchKit({ ...seed(), rubricVersion: 'writing-v1' }, 'summarization-v1').draft.rubricVersion).toBe('writing-v1')
    const summary = switchKit(seed(), 'summarization-v1').draft
    expect(switchKit(summary, 'classification-v1').draft.rubricVersion).toBe('classification-v1')
    expect(switchKit(summary, 'general-v1').draft.rubricVersion).toBeUndefined()
  })

  it('names and removes question fields of another kit and conversations the kit cannot take', () => {
    const routing = CASE_TEMPLATES.find((t) => t.id === 'ticket-routing')!.apply!(seed(), newId)
    const withHistory: DraftInput = { ...routing, cases: routing.cases.map((c, i) => (i === 0 ? { ...c, messages: history } : c)) }
    const { draft, removals } = switchKit(withHistory, 'summarization-v1')
    expect(removals).toEqual([
      'Switching to Summaries removes answer keys from 5 questions.',
      "Summaries questions can't carry a conversation yet, so switching removes the earlier conversation from 1 question.",
    ])
    expect(draft.cases.every((c) => c.kitFields === undefined && c.messages === undefined)).toBe(true)
    const general = switchKit(routing, 'general-v1')
    expect(general.draft).not.toHaveProperty('kit')
    expect(general.draft.cases.every((c) => c.kitFields === undefined)).toBe(true)
    expect(general.removals).toEqual(['Switching to General answers removes answer keys from 5 questions.'])
    expect(draftInputSchema.safeParse(general.draft).success).toBe(true)
  })

  it('choosing the current kit changes nothing', () => {
    const draft = seed()
    expect(switchKit(draft, 'general-v1')).toEqual({ draft, removals: [] })
  })
})

describe('kit UI', () => {
  it('the picker names the current kit and its checks in one line', () => {
    const html = renderToStaticMarkup(<KitPicker draft={seed()} onChange={() => {}} />)
    expect(html).toContain('General answers')
    expect(html).toContain('no automatic checks')
  })

  it('the juror view shows the answer key and limits, never a result', () => {
    const html = renderToStaticMarkup(<KitFacts kitName="Classification" view={{ kind: 'classification', labels: ['Billing', 'Bug'], expectedLabel: 'Billing', alsoAccept: [] }} />)
    expect(html).toContain('Allowed labels')
    expect(html).toContain('Billing · Bug')
    expect(html).not.toMatch(/Passed|Failed|said/)
    const summary = renderToStaticMarkup(<KitFacts kitName="Summaries" view={{ kind: 'summarization', lengthLimit: '100 words or fewer', format: 'bullets', requiredPoints: ['Refund window'], mustNotMention: [] }} />)
    expect(summary).toContain('100 words or fewer')
    expect(summary).toContain('Refund window')
  })
})
