import { describe, expect, it } from 'vitest'
import { CASE_IMPORT_COLUMNS, parseCasesCsv } from '@/domain/case-import'
import { draftInputSchema } from '@/domain/contracts'
import { toCsv } from '@/domain/csv'
import { makeExampleDraft } from '@/domain/example'
import { readinessIssues } from '@/domain/snapshot'
import { MODEL_ROUTES } from '@/domain/registry'
import { CASE_TEMPLATES } from './templates'

const newId = () => crypto.randomUUID()
const seed = () => makeExampleDraft(newId, [MODEL_ROUTES[0].key, MODEL_ROUTES[1].key])

describe('case templates', () => {
  it.each(CASE_TEMPLATES.map((t) => [t.id, t] as const))('%s produces a valid, runnable draft', (_id, template) => {
    const draft = template.apply ? template.apply(seed(), newId) : seed()
    expect(draftInputSchema.safeParse(draft).success).toBe(true)
    expect(readinessIssues(draft, MODEL_ROUTES)).toEqual([])
    expect(new Set(draft.cases.map((c) => c.key)).size).toBe(draft.cases.length)
    expect(new Set(draft.configurations.map((c) => c.key)).size).toBe(draft.configurations.length)
  })

  it('the downloadable CSV template imports cleanly', () => {
    const csv = toCsv(CASE_IMPORT_COLUMNS, [['Outside the return window', 'I bought this 45 days ago.', 'Returns within 30 days.', 'Explain the 30-day limit.', 'en']])
    const result = parseCasesCsv(csv, newId)
    expect(result.ok).toBe(true)
  })
})
