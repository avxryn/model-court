/**
 * Spec 07 (D-108): Gemini parties in drafts. Routes are listed but unverified; kits that need JSON
 * output, a PDF or tools refuse a Gemini party in plain words, whatever checks are recorded.
 */

import { describe, expect, it } from 'vitest'
import { makeExampleDraft } from './example'
import { EXTRACTION_STARTERS } from './extraction/starters'
import { MODEL_ROUTES } from './registry'
import { describeIssue, readinessIssues } from './snapshot'
import { EXAMPLE_TOOL_TASK } from './tools/task'

let n = 0
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const ALL_CHECKED = MODEL_ROUTES.map((route) => ({ ...route, verifiedAt: '2026-11-19', multiTurnVerifiedAt: '2026-11-19', structuredVerifiedAt: '2026-11-19', pdfVerifiedAt: '2026-11-19', toolsVerifiedAt: '2026-11-19' }))

function withGemini() {
  const draft = makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
  return { ...draft, comparisonMode: 'configuration' as const, configurations: [...draft.configurations, { ...draft.configurations[0], key: newId(), label: 'Gemini', modelKey: 'google-gemini-3-6-flash' }] }
}

describe('Gemini parties in a draft', () => {
  it('is awaiting its live check until a call is recorded', () => {
    const issues = readinessIssues(withGemini(), MODEL_ROUTES)
    expect(issues.map((issue) => issue.kind)).toEqual(['model_unavailable'])
    expect(describeIssue(issues[0])).toContain('Google Gemini 3.6 Flash has not passed its live check yet')
    expect(readinessIssues(withGemini(), ALL_CHECKED)).toEqual([])
  })

  it('is refused by an extraction kit in plain words, even with every check recorded', () => {
    const draft = { ...withGemini(), kit: { version: 'extraction-v1', settings: { schema: EXTRACTION_STARTERS[1].schema, compare: {} } } }
    const cases = draft.cases.slice(0, 1).map((c) => ({ ...c, reference: '', kitFields: { kind: 'extraction' as const } }))
    const issues = readinessIssues({ ...draft, cases } as never, ALL_CHECKED).filter((issue) => issue.kind === 'feature_unsupported')
    expect(issues).toHaveLength(1)
    expect(describeIssue(issues[0])).toBe("Google Gemini 3.6 Flash can't return answers as fields in Model Court, so it can't be a party when fields are pulled from documents. Choose an OpenAI or Anthropic model for this party.")
  })

  it('is refused by the tools kit in plain words, even with every check recorded', () => {
    const draft = { ...withGemini(), kit: { version: 'tools-v1', settings: {} } }
    const cases = draft.cases.slice(0, 1).map((c) => ({ ...c, reference: '', kitFields: { kind: 'tools' as const, ...EXAMPLE_TOOL_TASK } }))
    const issues = readinessIssues({ ...draft, cases } as never, ALL_CHECKED).filter((issue) => issue.kind === 'feature_unsupported')
    expect(issues).toHaveLength(1)
    expect(describeIssue(issues[0])).toContain("Google Gemini 3.6 Flash can't call mock tools in Model Court")
  })

  it('runs with the text kits (summaries, classification, sources) like any route', () => {
    for (const kit of [{ version: 'summarization-v1', settings: { lengthUnit: 'words', maxLength: 80, format: 'prose', checkNumbers: false } }, { version: 'classification-v1', settings: { labels: ['A', 'B'], minReasoningWords: 0 } }]) {
      const issues = readinessIssues({ ...withGemini(), kit } as never, ALL_CHECKED)
      expect(issues.filter((issue) => issue.kind === 'feature_unsupported'), kit.version).toEqual([])
    }
  })
})
