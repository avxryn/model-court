/**
 * CSV case import (P1). Pure and browser-safe: the editor parses a file
 * locally, then saves the result through the normal draft PUT, which the
 * server re-validates. Validation uses the same Zod contracts as the editor.
 *
 * Format: a header row, then one row per case (at most LIMITS.maxCases).
 *   title, input, expected_behavior   required
 *   reference                         optional (empty when absent)
 * Header names are case-insensitive; spaces, hyphens and camelCase map to the
 * same column (`Expected behavior`, `expected-behavior`, `expectedBehavior`).
 * Cell values are kept exactly as written: no trimming, no normalization, and
 * no removal of a leading `'` that a spreadsheet may have shown.
 */

import { casesSchema, caseInputSchema, draftInputSchema, type CaseInput, type DraftInput } from './contracts'
import { parseCsv } from './csv'
import { LIMITS } from './limits'
import { utf8ByteLength } from './text'

export const CASE_IMPORT_COLUMNS = ['title', 'input', 'reference', 'expected_behavior', 'language'] as const
type Column = (typeof CASE_IMPORT_COLUMNS)[number]
const REQUIRED: readonly Column[] = ['title', 'input', 'expected_behavior']
const FIELD: Record<Column, 'title' | 'input' | 'reference' | 'expectedBehavior' | 'language'> = { title: 'title', input: 'input', reference: 'reference', expected_behavior: 'expectedBehavior', language: 'language' }

export interface ImportIssue {
  /** 1-based data row (the header is row 0); null for file-level problems. */
  row: number | null
  field: Column | null
  message: string
}

export type CaseImportResult = { ok: true; cases: CaseInput[] } | { ok: false; issues: ImportIssue[] }

function normalizeHeader(name: string): string {
  return name
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/** Parse and validate a cases CSV. `newId` supplies each case's key (UUID). */
export function parseCasesCsv(text: string, newId: () => string): CaseImportResult {
  if (utf8ByteLength(text) > LIMITS.caseImportCsvBytes) {
    return { ok: false, issues: [{ row: null, field: null, message: `The file is larger than ${LIMITS.caseImportCsvBytes / 1024} KiB.` }] }
  }
  const parsed = parseCsv(text)
  if (!parsed.ok) return { ok: false, issues: [{ row: null, field: null, message: `${parsed.error} (line ${parsed.line}).` }] }
  const [header, ...rows] = parsed.rows
  if (!header) return { ok: false, issues: [{ row: null, field: null, message: 'The file is empty. Add a header row: title, input, reference, expected_behavior.' }] }

  const issues: ImportIssue[] = []
  const columns: Array<Column | null> = header.map((name) => {
    const normalized = normalizeHeader(name)
    if ((CASE_IMPORT_COLUMNS as readonly string[]).includes(normalized)) return normalized as Column
    issues.push({ row: null, field: null, message: `Unknown column "${name}". Allowed: ${CASE_IMPORT_COLUMNS.join(', ')}.` })
    return null
  })
  for (const column of CASE_IMPORT_COLUMNS) {
    if (columns.filter((c) => c === column).length > 1) issues.push({ row: null, field: column, message: `Column "${column}" appears more than once.` })
  }
  for (const column of REQUIRED) {
    if (!columns.includes(column)) issues.push({ row: null, field: column, message: `Missing required column "${column}".` })
  }
  if (issues.length > 0) return { ok: false, issues }

  if (rows.length < LIMITS.minCases) return { ok: false, issues: [{ row: null, field: null, message: 'The file has no cases below the header row.' }] }
  if (rows.length > LIMITS.maxCases) return { ok: false, issues: [{ row: null, field: null, message: `At most ${LIMITS.maxCases} cases; the file has ${rows.length}.` }] }

  const cases: CaseInput[] = []
  rows.forEach((cells, index) => {
    const row = index + 1
    if (cells.length !== header.length) {
      issues.push({ row, field: null, message: `Row has ${cells.length} cells; the header has ${header.length}.` })
      return
    }
    const candidate: CaseInput = { key: newId(), title: '', input: '', reference: '', expectedBehavior: '' }
    columns.forEach((column, i) => {
      // An empty language cell means "untagged", not an invalid blank tag.
      if (column === 'language' && cells[i].trim() === '') return
      if (column) candidate[FIELD[column]] = cells[i]
    })
    const result = caseInputSchema.safeParse(candidate)
    if (result.success) {
      cases.push(result.data)
      return
    }
    for (const issue of result.error.issues) {
      const field = CASE_IMPORT_COLUMNS.find((column) => FIELD[column] === issue.path[0]) ?? null
      issues.push({ row, field, message: issue.message })
    }
  })
  if (issues.length > 0) return { ok: false, issues }

  const all = casesSchema.safeParse(cases)
  if (!all.success) return { ok: false, issues: all.error.issues.map((issue) => ({ row: null, field: null, message: issue.message })) }
  return { ok: true, cases: all.data }
}

/**
 * Replace a draft's cases with imported ones and validate the whole draft
 * (including the 96 KiB cap). Configurations and mode are kept.
 */
export function applyImportedCases(draft: DraftInput, cases: CaseInput[]): { ok: true; draft: DraftInput } | { ok: false; issues: ImportIssue[] } {
  const result = draftInputSchema.safeParse({ ...draft, cases })
  if (result.success) return { ok: true, draft: result.data }
  return { ok: false, issues: result.error.issues.map((issue) => ({ row: null, field: null, message: issue.message })) }
}
