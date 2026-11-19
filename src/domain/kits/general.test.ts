import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from '../canonical'
import { draftInputSchema, type CaseInput } from '../contracts'
import { makeExampleDraft } from '../example'
import { buildConversation, buildKitRequest, MESSAGE_TEMPLATES } from '../messages'
import { MODEL_ROUTES } from '../registry'
import { buildSnapshot, describeIssue, readinessIssues } from '../snapshot'
import { DEFAULT_KIT_VERSION, inputKindOf, kitFor, kitReadinessIssues, kitVersionOf, KITS } from './registry'

function fixedIds() {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}

const routes: [string, string] = ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5']
const history = [
  { role: 'user' as const, content: 'Hi' },
  { role: 'assistant' as const, content: 'Hello' },
]

describe('general-v1 is exactly today', () => {
  it('pre-kit snapshots keep their canonical JSON and hash (computed with the code before spec 03)', async () => {
    const draft = makeExampleDraft(fixedIds(), routes)
    const withHistory = { ...draft, cases: draft.cases.map((c, i) => (i === 0 ? { ...c, messages: history } : c)) }
    const fixtures: Array<[typeof draft, string, number]> = [
      [draft, '87c72271fc347dbcd3b101081eb2dfb22dff875f7b6e71cdabe1d5705c836a58', 3350],
      [withHistory, '5f4145493af1defd7d93d5d87562433449551d0efc45e910bc70e4e24b924cc3', 3435],
      [{ ...draft, rubricVersion: 'writing-v1', samplesPerAnswer: 2 }, 'b6704f3e75eef10fdb1a7bc0de79ae2541a6966c4f486c09d0e9fc9601747163', 3366],
    ]
    for (const [input, hash, length] of fixtures) {
      const snapshot = buildSnapshot({ ...input, schemaVersion: 1 }, MODEL_ROUTES, 'test-commit', 1763478000000)
      expect(snapshot).not.toHaveProperty('kit')
      expect(JSON.stringify(snapshot).length).toBe(length)
      expect(await sha256Hex(canonicalJson(snapshot))).toBe(hash)
    }
  })

  it('buildKitRequest equals buildConversation byte for byte for qa-v1 and chat-v1', () => {
    const draft = makeExampleDraft(fixedIds(), routes)
    for (const testCase of [...draft.cases, { ...draft.cases[0], messages: history }, { ...draft.cases[1], messages: [...history, ...history] }]) {
      for (const version of ['qa-v1', 'chat-v1'] as const) {
        const expected = buildConversation(version, 'SYSTEM', testCase)
        expect(JSON.stringify(buildKitRequest({ messageTemplateVersion: version }, 'SYSTEM', testCase))).toBe(JSON.stringify(expected))
      }
    }
    // Snapshots from before D-39 recorded no template and used qa-v1.
    expect(buildKitRequest({}, 'S', draft.cases[0])).toEqual(buildConversation('qa-v1', 'S', draft.cases[0]))
    expect(buildKitRequest({ messageTemplateVersion: 'nope-v9' as never }, 'S', draft.cases[0])).toBeNull()
    // A kit template without the kit's settings is refused, not thrown (D-80).
    expect(buildKitRequest({ messageTemplateVersion: 'summarize-v1' }, 'S', draft.cases[0])).toBeNull()
    expect(buildKitRequest({ messageTemplateVersion: 'classify-v1' }, 'S', draft.cases[0])).toBeNull()
    expect(Object.keys(MESSAGE_TEMPLATES)).toEqual(expect.arrayContaining(['chat-v1', 'qa-v1']))
  })

  it('reviewer-only fields never reach a built request (sentinel test)', () => {
    const draft = makeExampleDraft(fixedIds(), routes)
    const sentinel = 'SENTINEL-REVIEWER-ONLY'
    const testCase = { ...draft.cases[0], expectedBehavior: sentinel, title: sentinel, language: sentinel, kitFields: { kind: 'x', answer: sentinel } } as unknown as CaseInput
    const reached = new Set<string>()
    for (const kit of Object.values(KITS)) {
      for (const withMessages of [false, true]) {
        const prompt = withMessages ? { ...testCase, messages: history } : testCase
        const messageTemplateVersion = kit.selectTemplate([prompt])
        reached.add(messageTemplateVersion)
        const request = buildKitRequest({ messageTemplateVersion, kit: { version: kit.version, settings: kit.defaultSettings } }, 'S', prompt, { kind: 'text', text: 'A document.' })
        expect(request).not.toBeNull()
        expect(JSON.stringify(request)).not.toContain(sentinel)
      }
    }
    // Every template a kit can choose is covered.
    expect([...reached].sort()).toEqual(Object.keys(MESSAGE_TEMPLATES).sort())
  })

  it('the registry falls back to general-v1 and states the version explicitly', () => {
    expect(DEFAULT_KIT_VERSION).toBe('general-v1')
    expect(kitFor(undefined)).toBe(KITS['general-v1'])
    expect(kitFor('unknown-v9')).toBe(KITS['general-v1'])
    expect(kitVersionOf({})).toBe('general-v1')
    expect(kitVersionOf({ kit: { version: 'summarization-v1' } })).toBe('summarization-v1')
    expect(inputKindOf({ messages: history })).toBe('conversation')
    expect(inputKindOf({})).toBe('text')
  })

  it('drafts reject kit fields without a kit, and general-v1 adds no readiness issue', () => {
    const draft = makeExampleDraft(fixedIds(), routes)
    expect(draftInputSchema.safeParse(draft).success).toBe(true)
    const withFields = { ...draft, cases: draft.cases.map((c) => ({ ...c, kitFields: { kind: 'summarization', requiredPoints: [], mustNotMention: [] } })) }
    expect(draftInputSchema.safeParse(withFields).success).toBe(false)
    expect(draftInputSchema.safeParse({ ...draft, kit: { version: 'general-v1' } }).success).toBe(false)
    expect(readinessIssues(draft, MODEL_ROUTES.map((r) => ({ ...r, verifiedAt: '2026-11-16' })))).toEqual([])
    expect(kitReadinessIssues({ kit: { version: 'nope-v1', settings: {} }, cases: draft.cases })).toEqual([{ kind: 'kit_unknown', version: 'nope-v1' }])
  })

  it('describes kit readiness issues in plain words, naming the question', () => {
    const cases = [{ key: 'a' }, { key: 'b' }]
    expect(describeIssue({ kind: 'kit_input_unsupported', caseKey: 'b', inputKind: 'conversation', kitVersion: 'general-v1' }, cases)).toBe(
      "General answers questions can't carry a conversation yet. Remove it from Q2 or switch the task kit to General answers.",
    )
    expect(describeIssue({ kind: 'kit_document_missing', caseKey: 'zz', kitVersion: 'general-v1' })).toContain('a question')
    expect(describeIssue({ kind: 'kit_unknown', version: 'x' })).toContain('task kit')
  })
})
