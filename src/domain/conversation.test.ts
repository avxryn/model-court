import { describe, expect, it } from 'vitest'
import { draftInputSchema } from './contracts'
import { makeExampleDraft } from './example'
import { buildConversation, buildMessages, CHAT_TEMPLATE_VERSION, MESSAGE_TEMPLATE_VERSION, templateFor } from './messages'
import { MODEL_ROUTES } from './registry'
import { readinessIssues } from './snapshot'

const testCase = { reference: 'Returns within 30 days with a receipt.', input: 'And if I lost the receipt?' }
const history = [
  { role: 'user' as const, content: 'I bought this 12 days ago. Can I return it?' },
  { role: 'assistant' as const, content: 'Yes, within 30 days with a receipt.' },
]

describe('chat-v1 template (D-39)', () => {
  it('is byte-identical to qa-v1 when there is no history', () => {
    const legacy = buildMessages('SYS', testCase)
    for (const template of [MESSAGE_TEMPLATE_VERSION, CHAT_TEMPLATE_VERSION] as const) {
      const built = buildConversation(template, 'SYS', testCase)
      expect(built.system).toBe(legacy.system)
      expect(built.messages).toEqual([{ role: 'user', content: legacy.user }])
    }
  })

  it('wraps the first user turn with the reference and keeps later turns verbatim', () => {
    const built = buildConversation(CHAT_TEMPLATE_VERSION, 'SYS', { ...testCase, messages: history })
    expect(built.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(built.messages[0].content).toBe(buildMessages('SYS', { reference: testCase.reference, input: history[0].content }).user)
    expect(built.messages[1].content).toBe(history[1].content)
    expect(built.messages[2].content).toBe(testCase.input)
  })

  it('qa-v1 hearings never send history, and the template follows the cases', () => {
    expect(buildConversation(MESSAGE_TEMPLATE_VERSION, 'SYS', { ...testCase, messages: history }).messages).toHaveLength(1)
    expect(templateFor([{}, { messages: [] }])).toBe('qa-v1')
    expect(templateFor([{}, { messages: history }])).toBe('chat-v1')
  })
})

describe('conversation validation', () => {
  const draft = () => makeExampleDraft(() => crypto.randomUUID(), [MODEL_ROUTES[0].key, MODEL_ROUTES[1].key])
  const withHistory = (messages: unknown) => {
    const d = draft()
    return draftInputSchema.safeParse({ ...d, cases: d.cases.map((c, i) => (i === 0 ? { ...c, messages } : c)) })
  }

  it('accepts alternating turns that start with the user and end with the assistant', () => {
    expect(withHistory(history).success).toBe(true)
  })

  it('rejects bad shapes and oversize history', () => {
    expect(withHistory([history[1], history[0]]).success).toBe(false) // starts with the assistant
    expect(withHistory([history[0]]).success).toBe(false) // ends with the user
    expect(withHistory([history[0], history[0]]).success).toBe(false) // does not alternate
    expect(withHistory(Array.from({ length: 6 }, () => history).flat()).success).toBe(false) // 12 > 10 messages
    expect(withHistory([{ role: 'user', content: 'x'.repeat(4_000) }, { role: 'assistant', content: 'y'.repeat(4_001) }]).success).toBe(false)
    expect(withHistory([{ role: 'system', content: 'x' }, history[1]]).success).toBe(false)
  })

  it('blocks a hearing with history until the route passes a multi-message check', () => {
    const d = draft()
    const tagged = { ...d, cases: d.cases.map((c, i) => (i === 0 ? { ...c, messages: history } : c)) }
    expect(readinessIssues(tagged, MODEL_ROUTES).map((issue) => issue.kind)).toEqual(['history_unverified', 'history_unverified'])
    expect(readinessIssues(tagged, MODEL_ROUTES.map((route) => ({ ...route, multiTurnVerifiedAt: '2026-11-17' })))).toEqual([])
    expect(readinessIssues(d, MODEL_ROUTES)).toEqual([])
  })
})
