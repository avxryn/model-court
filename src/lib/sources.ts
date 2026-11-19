/**
 * The sources editor's pure rules (spec 05 §3, D-95), shared by the editor and its tests.
 * Rows keep the number they were saved under, so moving or removing a source renumbers the
 * question's "A good answer cites" with it.
 */

import type { SourceInput } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { codePointLength } from '@/domain/text'

export interface SourceRow {
  /** A stable key for React. */
  id: string
  /** The number this row was saved under; null for a row added since. */
  savedNumber: number | null
  title: string
  text: string
  origin: string
}

export function rowsOf(saved: ReadonlyArray<{ number: number; title: string | null; origin: string | null; text: string }>, newId: () => string): SourceRow[] {
  return saved.map((source) => ({ id: newId(), savedNumber: source.number, title: source.title ?? '', text: source.text, origin: source.origin ?? '' }))
}

/** The PUT body's sources: numbered by position, blank titles and notes left out, text as written. */
export function sourcesOf(rows: readonly SourceRow[]): SourceInput[] {
  return rows.map((row, index) => ({ number: index + 1, text: row.text, ...(row.title.trim() !== '' ? { title: row.title } : {}), ...(row.origin.trim() !== '' ? { origin: row.origin } : {}) }))
}

/**
 * The required sources after the rows' moves and removals: each saved number follows its row;
 * a required source whose row was removed is dropped (and named, so the editor can say so).
 */
export function remapRequired(required: readonly number[], rows: readonly SourceRow[]): { required: number[]; dropped: number[] } {
  const next: number[] = []
  const dropped: number[] = []
  for (const number of required) {
    const index = rows.findIndex((row) => row.savedNumber === number)
    if (index < 0) dropped.push(number)
    else next.push(index + 1)
  }
  return { required: next.sort((a, b) => a - b), dropped: dropped.sort((a, b) => a - b) }
}

export function rowsChanged(rows: readonly SourceRow[], saved: ReadonlyArray<{ number: number; title: string | null; origin: string | null; text: string }>): boolean {
  if (rows.length !== saved.length) return true
  return rows.some((row, index) => row.savedNumber !== index + 1 || row.text !== saved[index].text || row.title !== (saved[index].title ?? '') || row.origin !== (saved[index].origin ?? ''))
}

export function chars(texts: readonly string[]): number {
  return texts.reduce((sum, text) => sum + codePointLength(text), 0)
}

/** Limits the editor checks before saving (the server checks them again). */
export function rowProblems(rows: readonly SourceRow[], otherQuestionsChars: number): string[] {
  const G = LIMITS.grounded
  const problems: string[] = []
  if (rows.length === 0) problems.push('Add at least one source.')
  if (rows.length > G.sourcesPerQuestion.max) problems.push(`At most ${G.sourcesPerQuestion.max} sources per question.`)
  rows.forEach((row, index) => {
    const length = codePointLength(row.text)
    if (row.text.trim() === '') problems.push(`S${index + 1} has no text.`)
    else if (length > G.sourceText.max) problems.push(`S${index + 1} is ${length.toLocaleString('en-US')} characters; at most ${G.sourceText.max.toLocaleString('en-US')}.`)
    if (codePointLength(row.title) > G.sourceTitle.max) problems.push(`S${index + 1}'s title is longer than ${G.sourceTitle.max} characters.`)
    if (/[\r\n]/u.test(row.title)) problems.push(`S${index + 1}'s title must be one line.`)
    if (codePointLength(row.origin) > G.sourceOrigin.max) problems.push(`S${index + 1}'s note is longer than ${G.sourceOrigin.max} characters.`)
  })
  const question = chars(rows.map((row) => row.text))
  if (question > G.questionChars) problems.push(`This question's sources are ${question.toLocaleString('en-US')} characters; at most ${G.questionChars.toLocaleString('en-US')}.`)
  if (question + otherQuestionsChars > G.caseChars) problems.push(`With the other questions the case's sources would be ${(question + otherQuestionsChars).toLocaleString('en-US')} characters; at most ${G.caseChars.toLocaleString('en-US')}.`)
  return problems
}
