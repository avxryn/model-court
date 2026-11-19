import { describe, expect, it } from 'vitest'
import { CASE_IMPORT_COLUMNS, parseCasesCsv } from '@/domain/case-import'
import { draftInputSchema } from '@/domain/contracts'
import { toCsv } from '@/domain/csv'
import { makeExampleDraft } from '@/domain/example'
import { readinessIssues } from '@/domain/snapshot'
import { MODEL_ROUTES } from '@/domain/registry'
import { CASE_TEMPLATES } from './templates'

const newId = () => crypto.randomUUID()
const seed = () => makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])

describe('case templates', () => {
  it.each(CASE_TEMPLATES.map((t) => [t.id, t] as const))('%s produces a valid, runnable draft', (_id, template) => {
    const draft = template.apply ? template.apply(seed(), newId) : seed()
    expect(draftInputSchema.safeParse(draft).success).toBe(true)
    // Spec 04: the extraction template's documents are uploaded after the draft, and its routes need a structured check.
    const withDocuments = template.documents
      ? { ...draft, cases: draft.cases.map((c) => ({ ...c, kitFields: { ...(c.kitFields as object), document: { sha256: 'a'.repeat(64), byteLength: 1, delivery: 'text', pageCount: null } } })) }
      : template.sources
        ? // Spec 05: the sources template's sources are saved after the draft; the server writes their references.
          { ...draft, cases: draft.cases.map((c, i) => ({ ...c, kitFields: { ...(c.kitFields as object), sources: template.sources![i].map((_, n) => ({ number: n + 1, sha256: 'a'.repeat(64), byteLength: 1 })) } })) }
        : draft
    const routes = template.documents ? MODEL_ROUTES.map((route) => ({ ...route, structuredVerifiedAt: '2026-11-19' })) : MODEL_ROUTES
    expect(readinessIssues(withDocuments as typeof draft, routes)).toEqual([])
    expect(template.documents?.length ?? draft.cases.length).toBe(draft.cases.length)
    expect(template.sources?.length ?? draft.cases.length).toBe(draft.cases.length)
    expect(new Set(draft.cases.map((c) => c.key)).size).toBe(draft.cases.length)
    expect(new Set(draft.configurations.map((c) => c.key)).size).toBe(draft.configurations.length)
  })

  it('the downloadable CSV template imports cleanly', () => {
    const csv = toCsv(CASE_IMPORT_COLUMNS, [['Outside the return window', 'I bought this 45 days ago.', 'Returns within 30 days.', 'Explain the 30-day limit.', 'en']])
    const result = parseCasesCsv(csv, newId)
    expect(result.ok).toBe(true)
  })
})
