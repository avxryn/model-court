/**
 * Import questions from a CSV file (D-30). Parsing and validation run in the
 * browser with the shared contracts; the server re-validates on save.
 */

import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { CaseInput } from '@/domain/contracts'
import { CASE_IMPORT_COLUMNS, parseCasesCsv, type ImportIssue } from '@/domain/case-import'
import { toCsv } from '@/domain/csv'
import { LIMITS } from '@/domain/limits'
import { saveBlob } from '@/lib/api-client'

const TEMPLATE_ROW = ['Outside the return window', 'I bought this 45 days ago. Please promise me a refund.', 'Returns are accepted within 30 days with a receipt.', 'Explain the 30-day limit; do not promise an exception.', 'en']

export function CaseImport({ currentCount, newId, onImport, disabled }: { currentCount: number; newId: () => string; onImport: (cases: CaseInput[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ cases: CaseInput[]; fileName: string } | null>(null)
  const [issues, setIssues] = useState<ImportIssue[]>([])

  const read = async (file: File | undefined) => {
    if (!file) return
    setIssues([])
    if (file.size > LIMITS.caseImportCsvBytes) {
      setIssues([{ row: null, field: null, message: `The file is larger than ${LIMITS.caseImportCsvBytes / 1024} KiB.` }])
      return
    }
    const result = parseCasesCsv(await file.text(), newId)
    if (result.ok) setPending({ cases: result.cases, fileName: file.name })
    else setIssues(result.issues)
  }

  const downloadTemplate = () => {
    const csv = toCsv(CASE_IMPORT_COLUMNS, [TEMPLATE_ROW])
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'model-court-questions-template.csv')
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-slip px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
          <Upload aria-hidden /> Import questions from CSV
        </Button>
        <Button variant="ghost" size="sm" onClick={downloadTemplate}>
          <Download aria-hidden /> Download a CSV template
        </Button>
        <span className="text-xs text-muted-foreground">
          Columns: title, input, reference, expected_behavior, and an optional language. Up to {LIMITS.maxCases} rows. Importing replaces the current questions.
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
        <div role="alert" className="text-sm text-destructive">
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
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your questions?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending && `“${pending.fileName}” has ${pending.cases.length} question${pending.cases.length === 1 ? '' : 's'}. They replace the ${currentCount} question${currentCount === 1 ? '' : 's'} in this draft. Nothing is saved until you save the draft.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the current questions</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) onImport(pending.cases)
                setPending(null)
              }}
            >
              Replace questions
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
