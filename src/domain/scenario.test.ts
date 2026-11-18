import { describe, expect, it } from 'vitest'
import type { CaseInput, Draft } from './contracts'
import { makeExampleDraft } from './example'
import { MODEL_ROUTES } from './registry'
import { diffIsEmpty, diffParties, diffScenarios, partyFingerprint, questionHash, questionHashes, scenarioHash, scenarioSourceOfDraft, scenarioSourceOfSnapshot, type ScenarioSource } from './scenario'
import { buildSnapshot, type ImportMeta, type SnapshotConfiguration } from './snapshot'

let counter = 0
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const routeKeys = ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'] as const
const draftOf = (): Draft => ({ schemaVersion: 1, ...makeExampleDraft(newId, routeKeys) })
const source = (cases: CaseInput[], extra: Partial<ScenarioSource> = {}): ScenarioSource => ({ cases, rubricVersion: 'reference-qa-v1', messageTemplateVersion: 'qa-v1', ...extra })

const question: CaseInput = {
  key: '11111111-1111-4111-8111-111111111111',
  title: 'Ordinary request',
  input: 'Can I return it?',
  reference: 'Returns within 30 days.',
  expectedBehavior: 'Explain eligibility.',
}

describe('questionHash', () => {
  it('ignores key, title and language', async () => {
    const base = await questionHash(question)
    expect(await questionHash({ ...question, key: newId() })).toBe(base)
    expect(await questionHash({ ...question, title: 'Ordinary request (fixed typo)' })).toBe(base)
    expect(await questionHash({ ...question, language: 'en' })).toBe(base)
  })

  it('changes with input, reference, expected behavior or any message', async () => {
    const base = await questionHash(question)
    const conversation = [
      { role: 'user' as const, content: 'Hi' },
      { role: 'assistant' as const, content: 'Hello' },
    ]
    const variants: CaseInput[] = [
      { ...question, input: 'Can I return it now?' },
      { ...question, reference: 'Returns within 31 days.' },
      { ...question, expectedBehavior: 'Explain eligibility briefly.' },
      { ...question, messages: conversation },
      { ...question, messages: [conversation[0], { role: 'assistant', content: 'Hello!' }] },
    ]
    const hashes = await Promise.all(variants.map(questionHash))
    for (const hash of hashes) expect(hash).not.toBe(base)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('hashes fields it does not know (task kit fields, item 3)', async () => {
    const withKit = { ...question, kitFields: { kind: 'classification', label: 'refund' } } as unknown as CaseInput
    const otherKit = { ...question, kitFields: { kind: 'classification', label: 'exchange' } } as unknown as CaseInput
    expect(await questionHash(withKit)).not.toBe(await questionHash(question))
    expect(await questionHash(withKit)).not.toBe(await questionHash(otherKit))
  })
})

describe('scenarioHash', () => {
  const cases = draftOf().cases

  it('ignores question order and keys', async () => {
    const base = await scenarioHash(source(cases))
    expect(await scenarioHash(source([...cases].reverse()))).toBe(base)
    expect(await scenarioHash(source(cases.map((c) => ({ ...c, key: newId() }))))).toBe(base)
  })

  it('changes with a question added, removed or edited, and with each version', async () => {
    const base = await scenarioHash(source(cases))
    const variants = [
      source([...cases, { ...question }]),
      source(cases.slice(1)),
      source([{ ...cases[0], input: `${cases[0].input}?` }, ...cases.slice(1)]),
      source(cases, { rubricVersion: 'safety-v1' }),
      source(cases, { messageTemplateVersion: 'chat-v1' }),
      source(cases, { kitVersion: 'classification-v1' }),
      source(cases, { kitVersion: 'classification-v1', kitSettings: { labels: ['a', 'b'] } }),
    ]
    const hashes = await Promise.all(variants.map(scenarioHash))
    for (const hash of hashes) expect(hash).not.toBe(base)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('scenario-v1 golden value for the example questions (guards silent drift)', async () => {
    expect(await scenarioHash(source(cases))).toBe('e80a39ad78b502b1317ae0c4af3f8dd63dcef11c9064ca9c7cc4665f88dfebb3')
  })

  it('draft and snapshot sources hash equal, with and without a rubric version, with a conversation and with repeats', async () => {
    const draft = draftOf()
    const variants: Draft[] = [
      draft,
      { ...draft, rubricVersion: 'reference-qa-v1' },
      { ...draft, rubricVersion: 'safety-v1' },
      { ...draft, samplesPerAnswer: 3 },
      { ...draft, cases: [{ ...draft.cases[0], messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }] }, ...draft.cases.slice(1)] },
    ]
    for (const variant of variants) {
      const snapshot = buildSnapshot(variant, MODEL_ROUTES, 'test', 1)
      expect(await scenarioHash(scenarioSourceOfSnapshot(snapshot))).toBe(await scenarioHash(scenarioSourceOfDraft(variant)))
    }
    // The default rubric is the same scenario whether or not it is spelled out.
    expect(await scenarioHash(scenarioSourceOfDraft(variants[0]))).toBe(await scenarioHash(scenarioSourceOfDraft(variants[1])))
    // Repeats belong to the parties, not to the questions.
    expect(await scenarioHash(scenarioSourceOfDraft(variants[3]))).toBe(await scenarioHash(scenarioSourceOfDraft(variants[0])))
  })

  it('reads a frozen kit from the snapshot or draft', async () => {
    const draft = draftOf()
    const snapshot = buildSnapshot(draft, MODEL_ROUTES, 'test', 1)
    const plain = scenarioSourceOfSnapshot(snapshot)
    expect(plain.kitVersion).toBeUndefined()
    const kitted = scenarioSourceOfSnapshot({ ...snapshot, kit: { version: 'classification-v1', settings: { labels: ['x'] } } } as typeof snapshot)
    expect(kitted.kitVersion).toBe('classification-v1')
    expect(kitted.kitSettings).toEqual({ labels: ['x'] })
    expect(await scenarioHash(kitted)).not.toBe(await scenarioHash(plain))
    const kittedDraft = scenarioSourceOfDraft({ ...draft, kit: { version: 'classification-v1', settings: { labels: ['x'] } } } as typeof draft)
    expect(await scenarioHash(kittedDraft)).toBe(await scenarioHash(kitted))
  })
})

describe('partyFingerprint', () => {
  const draft = draftOf()
  const snapshot = buildSnapshot(draft, MODEL_ROUTES, 'test', 1)
  const [party] = snapshot.configurations

  it('ignores key, label and adapter version; changes with system prompt or model', async () => {
    const hashes = await questionHashes(snapshot.cases)
    const base = await partyFingerprint(party, hashes)
    expect(await partyFingerprint({ ...party, key: newId(), label: 'Renamed' }, hashes)).toBe(base)
    expect(await partyFingerprint({ ...party, adapterVersion: 'openai-responses-v99' } as SnapshotConfiguration, hashes)).toBe(base)
    expect(await partyFingerprint({ ...party, systemPrompt: 'Be brief.' } as SnapshotConfiguration, hashes)).not.toBe(base)
    expect(await partyFingerprint({ ...party, modelId: 'gpt-other' } as SnapshotConfiguration, hashes)).not.toBe(base)
  })

  it('keys imported parties by question content, not case key', async () => {
    const importedParty = { kind: 'imported' as const, key: newId(), label: 'Baseline', provenance: { sourceType: 'human_baseline' as const, description: 'Support team.', redacted: false } }
    const withImported: Draft = { ...draft, comparisonMode: 'configuration', configurations: [draft.configurations[0], importedParty] }
    const metas: ImportMeta[] = draft.cases.map((c, i) => ({ configurationKey: importedParty.key, caseKey: c.key, sha256: String(i).repeat(64), byteLength: 10 }))
    const first = buildSnapshot(withImported, MODEL_ROUTES, 'test', 1, metas)
    // A copy of the case: same questions with new keys, same answers.
    const keyMap = new Map(draft.cases.map((c) => [c.key, newId()]))
    const copied: Draft = { ...withImported, cases: draft.cases.map((c) => ({ ...c, key: keyMap.get(c.key)! })) }
    const second = buildSnapshot(copied, MODEL_ROUTES, 'test', 2, metas.map((m) => ({ ...m, caseKey: keyMap.get(m.caseKey)! })))
    const a = await partyFingerprint(first.configurations[1], await questionHashes(first.cases))
    const b = await partyFingerprint(second.configurations[1], await questionHashes(second.cases))
    expect(b).toBe(a)
    const edited = buildSnapshot(withImported, MODEL_ROUTES, 'test', 3, metas.map((m, i) => (i === 0 ? { ...m, sha256: 'f'.repeat(64) } : m)))
    expect(await partyFingerprint(edited.configurations[1], await questionHashes(edited.cases))).not.toBe(a)
    expect(await partyFingerprint({ ...first.configurations[1], provenance: { ...importedParty.provenance, redacted: true } } as SnapshotConfiguration, await questionHashes(first.cases))).not.toBe(a)
  })
})

describe('diffScenarios', () => {
  const cases = draftOf().cases

  it('is empty for the same questions in another order with other keys', async () => {
    const diff = await diffScenarios(source(cases), source([...cases].reverse().map((c) => ({ ...c, key: newId() }))))
    expect(diffIsEmpty(diff)).toBe(true)
  })

  it('reports added, removed and edited questions and version changes', async () => {
    const b = [{ ...cases[0], input: 'Changed?' }, ...cases.slice(1, 3), { ...cases[3], key: newId(), title: 'Renamed and changed', expectedBehavior: 'x' }, { ...question }]
    const diff = await diffScenarios(source(cases), source(b, { rubricVersion: 'safety-v1' }))
    expect(diff.edited).toEqual([{ fromKey: cases[0].key, toKey: cases[0].key, title: cases[0].title }])
    expect(diff.added.map((q) => q.title).sort()).toEqual(['Ordinary request', 'Renamed and changed'].sort())
    expect(diff.removed.map((q) => q.key).sort()).toEqual([cases[3].key, cases[4].key].sort())
    expect(diff.rubricChanged).toBe(true)
    expect(diff.templateChanged).toBe(false)
    expect(diffIsEmpty(diff)).toBe(false)
  })

  it('pairs an edited question by title when its key changed', async () => {
    const b = [{ ...cases[0], key: newId(), input: 'Changed?' }, ...cases.slice(1)]
    const diff = await diffScenarios(source(cases), source(b))
    expect(diff.edited).toEqual([{ fromKey: cases[0].key, toKey: b[0].key, title: cases[0].title }])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })
})

describe('diffParties', () => {
  const draft = draftOf()
  const snapshot = buildSnapshot(draft, MODEL_ROUTES, 'test', 1)
  const [a, b] = snapshot.configurations
  const route = MODEL_ROUTES.find((r) => r.provider === 'openai' && r.key !== routeKeys[0])!

  it('reports nothing for the same parties', () => {
    expect(diffParties(snapshot.configurations, snapshot.configurations)).toEqual([])
  })

  it('reports model and prompt changes, added and removed parties, by label then key', () => {
    const changedModel = { ...a, key: newId(), modelKey: route.key, modelId: route.modelId } as SnapshotConfiguration
    const changedPrompt = { ...b, label: 'Renamed', systemPrompt: 'Be brief.' } as SnapshotConfiguration
    const third = { ...a, key: newId(), label: 'Candidate 3' } as SnapshotConfiguration
    expect(diffParties([a, b], [changedModel, changedPrompt, third])).toEqual([
      { kind: 'model', label: 'Candidate 1', from: { provider: 'openai', modelId: (a as { modelId: string }).modelId }, to: { provider: 'openai', modelId: route.modelId } },
      { kind: 'prompt', label: 'Renamed' },
      { kind: 'added', label: 'Candidate 3' },
    ])
    expect(diffParties([a, b], [a])).toEqual([{ kind: 'removed', label: 'Candidate 2' }])
  })

  it('reports a switch between generated and imported, and changed imported answers', () => {
    const imported = { kind: 'imported' as const, key: b.key, label: b.label, provenance: { sourceType: 'other' as const, description: 'x', redacted: false }, source: 'imported' as const, imports: [{ caseKey: draft.cases[0].key, sha256: 'a'.repeat(64), byteLength: 1 }] }
    expect(diffParties([a, b], [a, imported])).toEqual([{ kind: 'source', label: 'Candidate 2', to: 'imported' }])
    const changed = { ...imported, imports: [{ ...imported.imports[0], sha256: 'b'.repeat(64) }] }
    expect(diffParties([a, imported], [a, changed])).toEqual([{ kind: 'answers', label: 'Candidate 2' }])
  })
})
