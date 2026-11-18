import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from './canonical'
import type { Configuration } from './contracts'
import { makeExampleDraft } from './example'
import { LIMITS } from './limits'
import { MODEL_ROUTES } from './registry'
import { scenarioHash, scenarioSourceOfDraft } from './scenario'
import { parseScenarioFile, SCENARIO_FORMAT } from './scenario-file'

const newId = () => crypto.randomUUID()
const example = makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
const defaults = example.configurations as Configuration[]
const luna = MODEL_ROUTES.find((r) => r.key === 'openai-gpt-6-luna')!
const haiku = MODEL_ROUTES.find((r) => r.key === 'anthropic-claude-haiku-5-5')!
const options = { routes: MODEL_ROUTES, defaults, maxParties: 3, includeParties: true }

function scenarioFile(extra: Record<string, unknown> = {}) {
  return {
    format: SCENARIO_FORMAT,
    formatVersion: 1,
    exportedAt: '2026-11-18T00:00:00.000Z',
    scenarioHashVersion: 'scenario-v1',
    scenarioHash: 'f'.repeat(64),
    title: 'Support policy QA',
    taskDescription: 'Reference-grounded answers',
    rubricVersion: 'reference-qa-v1',
    messageTemplateVersion: 'qa-v1',
    questions: example.cases.map(({ key: _key, ...question }) => question),
    ...extra,
  }
}

const parties = [
  { label: 'Fast', modelKey: luna.key, provider: luna.provider, modelId: luna.modelId, systemPrompt: 'Be brief.' },
  { label: 'Careful', modelKey: haiku.key, provider: haiku.provider, modelId: haiku.modelId, systemPrompt: 'Be careful.' },
]

describe('parseScenarioFile (D-71)', () => {
  it('reads a scenario file with fresh keys and the same scenario hash', async () => {
    const result = await parseScenarioFile(JSON.stringify(scenarioFile()), newId, options)
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(result.origin).toBe('scenario_file')
    expect(result.title).toBe('Support policy QA')
    expect(result.draft.cases.map((c) => c.key)).not.toEqual(example.cases.map((c) => c.key))
    expect(await scenarioHash(scenarioSourceOfDraft(result.draft))).toBe(await scenarioHash(scenarioSourceOfDraft(example)))
    // No parties in the file: the default pair, in model mode.
    expect(result.partiesFromFile).toBe(0)
    expect(result.draft.configurations.map((c) => c.label)).toEqual(['Candidate 1', 'Candidate 2'])
    expect(result.draft.comparisonMode).toBe('model')
  })

  it('takes parties only when asked, mapped to the catalog; unknown models and the cap become notices', async () => {
    const withParties = scenarioFile({ comparisonMode: 'configuration', parties: [...parties, { label: 'Ghost', modelKey: 'nope', provider: 'openai', modelId: 'gpt-0', systemPrompt: 'x' }, { ...parties[0], label: 'Fourth' }] })
    const result = await parseScenarioFile(JSON.stringify(withParties), newId, { ...options, maxParties: 2 })
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(result.draft.configurations).toEqual([
      { kind: 'model', key: expect.any(String), label: 'Fast', modelKey: luna.key, systemPrompt: 'Be brief.', maxOutputTokens: LIMITS.maxOutputTokens },
      { kind: 'model', key: expect.any(String), label: 'Careful', modelKey: haiku.key, systemPrompt: 'Be careful.', maxOutputTokens: LIMITS.maxOutputTokens },
    ])
    expect(result.partiesFromFile).toBe(2)
    expect(result.notices).toEqual(['Ghost skipped: model gpt-0 is not in this catalog.', 'Fourth skipped: this deployment allows at most 2 parties.'])
    const without = await parseScenarioFile(JSON.stringify(withParties), newId, { ...options, includeParties: false })
    expect(without.ok && without.draft.configurations.map((c) => c.label)).toEqual(['Candidate 1', 'Candidate 2'])
  })

  it('refuses unknown fields, malformed JSON, oversize files and invalid questions', async () => {
    const unknownTop = await parseScenarioFile(JSON.stringify(scenarioFile({ owner: 'x' })), newId, options)
    expect(unknownTop.ok).toBe(false)
    const unknownQuestion = await parseScenarioFile(JSON.stringify(scenarioFile({ questions: [{ ...scenarioFile().questions[0], secret: 1 }] })), newId, options)
    expect(unknownQuestion.ok).toBe(false)
    expect((await parseScenarioFile('{not json', newId, options)).ok).toBe(false)
    expect((await parseScenarioFile(' '.repeat(LIMITS.scenarioFileBytes + 1), newId, options)).ok).toBe(false)
    const empty = await parseScenarioFile(JSON.stringify(scenarioFile({ questions: [{ ...scenarioFile().questions[0], input: '' }] })), newId, options)
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.issues[0].path).toBe('questions.0.input')
    expect((await parseScenarioFile(JSON.stringify({ format: 'something-else' }), newId, options)).ok).toBe(false)
  })

  it('reads only the questions of a certified record, checks its certification, and ignores testimony and ratings', async () => {
    const body = {
      format: 'model-court-certified-record',
      formatVersion: 1,
      run: { runId: newId(), evaluationId: newId(), evaluationTitle: 'Recorded case', status: 'decided', comparisonMode: 'model', createdAt: 1, revealedAt: 2 },
      versions: { snapshotHash: 'a'.repeat(64), canonicalization: 'sorted-json-v1', rubricVersion: 'safety-v1', messageTemplateVersion: 'qa-v1', providerRegistryVersion: 'x', appCommit: 'y', priceTableVersion: 'z' },
      configurations: [
        { key: newId(), label: 'Party A', provider: luna.provider, modelId: luna.modelId, systemPrompt: 'Same', maxOutputTokens: 512 },
        { key: newId(), label: 'Party B', provider: null, modelId: null, systemPrompt: null, maxOutputTokens: null, source: 'imported', provenance: { sourceType: 'other', description: 'x' } },
      ],
      cases: example.cases.map((c, i) => ({ number: i + 1, ...c, eligible: true })),
      responses: [{ caseKey: example.cases[0].key, text: 'SECRET TESTIMONY' }],
      ratings: [{ note: 'SECRET NOTE' }],
      findings: {},
      setupMetrics: {},
      verdicts: [],
    }
    const record = { ...body, exportedAt: '2026-11-18T00:00:00.000Z', certification: { contentSha256: await sha256Hex(canonicalJson(body)), statement: 's' } }
    const result = await parseScenarioFile(JSON.stringify(record), newId, options)
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(result).toMatchObject({ origin: 'certified_record', title: 'Recorded case', certification: 'matches' })
    expect(result.draft.rubricVersion).toBe('safety-v1')
    expect(JSON.stringify(result.draft)).not.toContain('SECRET')
    expect(result.draft.cases.every((c, i) => c.key !== example.cases[i].key)).toBe(true)
    expect(result.notices).toEqual(['Only the questions are taken from this record; testimony, worksheets and judgments are left out.', 'Party B skipped: imported answers are not copied from a record.', 'Fewer than two parties could be used, so the default pair fills in.'])
    const edited = await parseScenarioFile(JSON.stringify({ ...record, run: { ...record.run, evaluationTitle: 'Changed' } }), newId, options)
    expect(edited.ok && edited.certification).toBe('edited')
  })
})
