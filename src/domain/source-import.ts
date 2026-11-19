/**
 * Sources CSV import (spec 05 §5.5, D-92). Pure and browser-safe: the editor parses the file
 * locally and saves each named question through the normal validated
 * `PUT /evaluations/:id/sources/:caseKey`, which the server re-validates. The file itself is
 * never sent.
 *
 * Format: a header row, then one row per source.
 *   question   required  1–5 or Q1–Q5: the question's position in the case
 *   source     optional  1–10 or S1–S10; when the column is absent, the rows' order per question
 *   title      optional  empty = none
 *   text       required  kept exactly as written (no trimming)
 *   origin     optional  the judge's note (never sent to a provider, never shown to jurors); empty = none
 * Header names follow the questions CSV (case-insensitive; spaces, hyphens and camelCase map).
 * The file replaces the sources of every question it names; other questions keep theirs.
 */

import { normalizeHeader } from './case-import'
import { putSourcesSchema, type SourceInput } from './contracts'
import { parseCsv } from './csv'
import { LIMITS } from './limits'
import { codePointLength, utf8ByteLength } from './text'

export const SOURCE_IMPORT_COLUMNS = ['question', 'source', 'title', 'text', 'origin'] as const
type Column = (typeof SOURCE_IMPORT_COLUMNS)[number]
const REQUIRED: readonly Column[] = ['question', 'text']

const G = LIMITS.grounded

export interface SourceImportIssue {
  /** 1-based data row (the header is row 0); null for file-level or question-level problems. */
  row: number | null
  field: Column | null
  message: string
}

export interface ImportedQuestionSources {
  /** 1-based position of the question in the case. */
  position: number
  sources: SourceInput[]
}

export type SourceImportResult = { ok: true; questions: ImportedQuestionSources[] } | { ok: false; issues: SourceImportIssue[] }

/**
 * Parse and validate a sources CSV for a case with `questionCount` questions. `existingChars[i]`
 * is the source text already saved on question i + 1, so the case total counts the questions
 * the file leaves alone.
 */
export function parseSourcesCsv(text: string, questionCount: number, existingChars: readonly number[] = []): SourceImportResult {
  if (utf8ByteLength(text) > G.importCsvBytes) return { ok: false, issues: [{ row: null, field: null, message: `The file is larger than ${G.importCsvBytes / 1024} KiB.` }] }
  const parsed = parseCsv(text)
  if (!parsed.ok) return { ok: false, issues: [{ row: null, field: null, message: `${parsed.error} (line ${parsed.line}).` }] }
  const [header, ...rows] = parsed.rows
  if (!header) return { ok: false, issues: [{ row: null, field: null, message: 'The file is empty. Add a header row: question, source, title, text, origin.' }] }

  const issues: SourceImportIssue[] = []
  const columns: Array<Column | null> = header.map((name) => {
    const normalized = normalizeHeader(name)
    if ((SOURCE_IMPORT_COLUMNS as readonly string[]).includes(normalized)) return normalized as Column
    issues.push({ row: null, field: null, message: `Unknown column "${name}". Allowed: ${SOURCE_IMPORT_COLUMNS.join(', ')}.` })
    return null
  })
  for (const column of SOURCE_IMPORT_COLUMNS) if (columns.filter((c) => c === column).length > 1) issues.push({ row: null, field: column, message: `Column "${column}" appears more than once.` })
  for (const column of REQUIRED) if (!columns.includes(column)) issues.push({ row: null, field: column, message: `Missing required column "${column}".` })
  if (issues.length > 0) return { ok: false, issues }
  if (rows.length === 0) return { ok: false, issues: [{ row: null, field: null, message: 'The file has no sources below the header row.' }] }
  const hasNumbers = columns.includes('source')

  const byQuestion = new Map<number, Array<{ row: number; number: number | null; source: Omit<SourceInput, 'number'> }>>()
  rows.forEach((cells, index) => {
    const row = index + 1
    if (cells.length !== header.length) {
      issues.push({ row, field: null, message: `Row has ${cells.length} cells; the header has ${header.length}.` })
      return
    }
    const cell = (column: Column) => {
      const i = columns.indexOf(column)
      return i < 0 ? '' : cells[i]
    }
    const question = /^[Qq]?(\d{1,2})$/u.exec(cell('question').trim())
    const position = question ? Number(question[1]) : NaN
    if (!question || position < 1) {
      issues.push({ row, field: 'question', message: 'Write the question as 1–5 or Q1–Q5.' })
      return
    }
    if (position > questionCount) {
      issues.push({ row, field: 'question', message: `Q${position} is not in this case (it has ${questionCount} ${questionCount === 1 ? 'question' : 'questions'}).` })
      return
    }
    let number: number | null = null
    if (hasNumbers) {
      const match = /^[Ss]?(\d{1,2})$/u.exec(cell('source').trim())
      if (!match || Number(match[1]) < 1 || Number(match[1]) > G.sourcesPerQuestion.max) {
        issues.push({ row, field: 'source', message: `Write the source as 1–${G.sourcesPerQuestion.max} or S1–S${G.sourcesPerQuestion.max}.` })
        return
      }
      number = Number(match[1])
    }
    const title = cell('title')
    const origin = cell('origin')
    const source = { text: cell('text'), ...(title.trim() !== '' ? { title } : {}), ...(origin.trim() !== '' ? { origin } : {}) }
    byQuestion.set(position, [...(byQuestion.get(position) ?? []), { row, number, source }])
  })
  if (issues.length > 0) return { ok: false, issues }

  const questions: ImportedQuestionSources[] = []
  for (const position of [...byQuestion.keys()].sort((a, b) => a - b)) {
    const entries = byQuestion.get(position)!
    if (hasNumbers) {
      const seen = new Map<number, number>()
      for (const entry of entries) {
        if (seen.has(entry.number!)) issues.push({ row: entry.row, field: 'source', message: `Q${position} has S${entry.number} twice (rows ${seen.get(entry.number!)} and ${entry.row}).` })
        else seen.set(entry.number!, entry.row)
      }
      entries.sort((a, b) => a.number! - b.number!)
      const gap = entries.findIndex((entry, index) => entry.number !== index + 1)
      if (gap >= 0 && issues.length === 0) issues.push({ row: entries[gap].row, field: 'source', message: `Q${position}'s sources must be numbered 1, 2, 3… with no gaps; S${gap + 1} is missing.` })
    }
    const sources: SourceInput[] = entries.map((entry, index) => ({ number: index + 1, ...entry.source }))
    const result = putSourcesSchema.safeParse({ sources })
    if (!result.success) {
      for (const issue of result.error.issues) {
        const at = typeof issue.path[1] === 'number' ? entries[issue.path[1]] : undefined
        const field = issue.path[2] === 'title' ? 'title' : issue.path[2] === 'origin' ? 'origin' : issue.path[2] === 'text' ? 'text' : null
        issues.push({ row: at?.row ?? null, field, message: `Q${position}: ${issue.message}` })
      }
      continue
    }
    questions.push({ position, sources: result.data.sources })
  }
  if (issues.length > 0) return { ok: false, issues }

  const named = new Map(questions.map((question) => [question.position, question.sources.reduce((sum, source) => sum + codePointLength(source.text), 0)]))
  let total = 0
  for (let position = 1; position <= questionCount; position++) total += named.get(position) ?? existingChars[position - 1] ?? 0
  if (total > G.caseChars) {
    return { ok: false, issues: [{ row: null, field: null, message: `The case's sources would be ${total.toLocaleString('en-US')} characters; the limit is ${G.caseChars.toLocaleString('en-US')} for all questions together.` }] }
  }
  return { ok: true, questions }
}

/** "Q1, Q2 and Q4" for the confirmation. */
export function questionList(positions: readonly number[]): string {
  const names = positions.map((position) => `Q${position}`)
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** The downloadable template (spec 05 §5.5). */
export const SOURCES_CSV_TEMPLATE = [
  'question,source,title,text,origin',
  '1,1,Refund policy,"Customers can request a refund within 30 days of purchase. Refunds go back to the original payment method.","kb-1432, retrieved Nov 12"',
  '1,2,Shipping,"Orders ship within 2 business days. Express shipping is available in the US only.",kb-0877',
  '2,1,Warranty,"Hardware is covered for one year from delivery. Accidental damage is not covered.",',
].join('\r\n') + '\r\n'
