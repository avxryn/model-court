import { describe, expect, it } from 'vitest'
import { draftInputSchema } from './contracts'
import { makeExampleDraft } from './example'
import { DIMENSIONS, RUBRIC, RUBRIC_VERSION, RUBRIC_VERSIONS, rubricLines, RUBRICS } from './rubric'
import { buildSnapshot } from './snapshot'
import { MODEL_ROUTES } from './registry'

const newId = () => crypto.randomUUID()

describe('rubric versions (D-35)', () => {
  it('every version scores the same three stored lines with all three anchors', () => {
    for (const version of RUBRIC_VERSIONS) {
      for (const d of DIMENSIONS) {
        const line = RUBRICS[version].lines[d]
        expect(line.label.length).toBeGreaterThan(0)
        expect(Object.keys(line.anchors).sort()).toEqual(['0', '1', '2'])
      }
    }
    expect(RUBRICS[RUBRIC_VERSION].lines).toBe(RUBRIC)
  })

  it('looks up labels by recorded version and falls back to the default', () => {
    expect(rubricLines('safety-v1').correctness.label).toBe('Refusal judgment')
    expect(rubricLines('writing-v1').grounding.label).toBe('Tone')
    expect(rubricLines(undefined)).toBe(RUBRIC)
    expect(rubricLines('unknown-v9')).toBe(RUBRIC)
  })

  it('snapshots record the draft rubric, defaulting when absent', () => {
    const draft = makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
    expect(buildSnapshot({ ...draft, schemaVersion: 1 }, MODEL_ROUTES, 'test', 0).rubricVersion).toBe('reference-qa-v1')
    expect(buildSnapshot({ ...draft, rubricVersion: 'writing-v1', schemaVersion: 1 }, MODEL_ROUTES, 'test', 0).rubricVersion).toBe('writing-v1')
    expect(draftInputSchema.safeParse({ ...draft, rubricVersion: 'nope' }).success).toBe(false)
  })

  it('language tags are optional, trimmed, and never blank', () => {
    const draft = makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
    const tagged = draftInputSchema.parse({ ...draft, cases: draft.cases.map((c) => ({ ...c, language: ' es ' })) })
    expect(tagged.cases[0].language).toBe('es')
    expect(draftInputSchema.safeParse({ ...draft, cases: draft.cases.map((c) => ({ ...c, language: '' })) }).success).toBe(false)
    expect(draftInputSchema.safeParse({ ...draft, cases: draft.cases.map((c) => ({ ...c, language: 'x'.repeat(36) })) }).success).toBe(false)
  })
})
