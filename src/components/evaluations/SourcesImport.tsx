/**
 * Import sources from a CSV file (spec 05 §5.5, D-95). Parsed in the browser with the shared
 * rules; the file is never sent. After a confirmation that names the questions it replaces,
 * each question is saved with its own validated PUT, one after another, each with the revision
 * the previous one returned. If one fails, the dialog says which were saved and which were not.
 */

import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { useGroundedSources } from '@/components/evaluations/SourcesEditor'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { CaseInput } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { parseSourcesCsv, questionList, SOURCES_CSV_TEMPLATE, type ImportedQuestionSources, type SourceImportIssue } from '@/domain/source-import'
import { api, describeError, saveBlob } from '@/lib/api-client'
import { chars } from '@/lib/sources'

export function SourcesImport({ cases, disabled }: { cases: readonly CaseInput[]; disabled?: boolean }) {
  const context = useGroundedSources()
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ questions: ImportedQuestionSources[]; fileName: string } | null>(null)
  const [issues, setIssues] = useState<SourceImportIssue[]>([])
  const [outcome, setOutcome] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canSave = !!context?.saved

  const read = async (file: File | undefined) => {
    if (!file) return
    setIssues([])
    setOutcome(null)
    if (file.size > LIMITS.grounded.importCsvBytes) {
      setIssues([{ row: null, field: null, message: `The file is larger than ${LIMITS.grounded.importCsvBytes / 1024} KiB.` }])
      return
    }
    const existing = cases.map((testCase) => chars(context?.sources.find((entry) => entry.caseKey === testCase.key)?.items.map((item) => item.text) ?? []))
    const result = parseSourcesCsv(await file.text(), cases.length, existing)
    if (result.ok) setPending({ questions: result.questions, fileName: file.name })
    else setIssues(result.issues)
  }

  const apply = async () => {
    if (!context || !pending) return
    setBusy(true)
    let revision = context.revision
    const done: number[] = []
    try {
      // D-98: questions whose sources shrink go first, so a file that is within the case total as a
      // whole is never refused halfway because a growing question was saved before a shrinking one.
      const existing = (position: number) => chars(context.sources.find((entry) => entry.caseKey === cases[position - 1]?.key)?.items.map((item) => item.text) ?? [])
      const ordered = [...pending.questions].sort((a, b) => chars(a.sources.map((s) => s.text)) - existing(a.position) - (chars(b.sources.map((s) => s.text)) - existing(b.position)))
      for (const question of ordered) {
        const caseKey = cases[question.position - 1]?.key
        if (!caseKey) continue
        // A required source beyond the new count would no longer exist, so it is unticked.
        const fields = cases[question.position - 1].kitFields as { answerable?: string; requiredSources?: number[] } | undefined
        const required = fields?.answerable === 'no' ? undefined : (fields?.requiredSources ?? []).filter((n) => n <= question.sources.length)
        revision = (await api<{ revision: number }>('PUT', `/evaluations/${context.evaluationId}/sources/${caseKey}`, { body: { sources: question.sources, ...(required ? { requiredSources: required } : {}) }, revision })).revision
        done.push(question.position)
      }
      setPending(null)
      context.onSaved()
    } catch (caught) {
      const left = pending.questions.map((question) => question.position).filter((position) => !done.includes(position))
      setOutcome(`${done.length > 0 ? `Saved the sources of ${questionList(done)}. ` : ''}Not saved: ${questionList(left)}. ${describeError(caught)}`)
      setPending(null)
      if (done.length > 0) context.onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-slip px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={disabled || !canSave} onClick={() => input.current?.click()}>
          <Upload aria-hidden /> Import sources from CSV
        </Button>
        <Button variant="ghost" size="sm" onClick={() => saveBlob(new Blob([SOURCES_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' }), 'model-court-sources-template.csv')}>
          <Download aria-hidden /> Download a sources template
        </Button>
        <span className="text-caption text-muted-foreground">
          Columns: question (1–{LIMITS.maxCases} or Q1), text, and optional source (1–{LIMITS.grounded.sourcesPerQuestion.max}), title and origin (your note, never sent). Read in your browser; the file isn’t uploaded. {canSave ? 'Replaces the sources of the questions it names.' : 'Save the draft first.'}
        </span>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            void read(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
      {issues.length > 0 && (
        <div role="alert" className="text-small text-destructive">
          <p className="font-medium">The file could not be imported:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {issues.slice(0, 8).map((issue, index) => (
              <li key={index}>
                {issue.row !== null && `Row ${issue.row}${issue.field ? `, ${issue.field}` : ''}: `}
                {issue.message}
              </li>
            ))}
            {issues.length > 8 && <li>…and {issues.length - 8} more.</li>}
          </ul>
        </div>
      )}
      {outcome && (
        <p role="alert" className="text-small text-destructive">
          {outcome}
        </p>
      )}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the sources of {pending ? questionList(pending.questions.map((question) => question.position)) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending &&
                `“${pending.fileName}” has ${pending.questions.reduce((sum, question) => sum + question.sources.length, 0)} sources for ${pending.questions.length === 1 ? 'one question' : `${pending.questions.length} questions`}. They replace those questions’ saved sources now; other questions keep theirs.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep the current sources</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void apply()}>
              {busy ? 'Saving…' : 'Replace sources'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
