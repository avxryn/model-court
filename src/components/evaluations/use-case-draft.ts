/**
 * The judge's working copy of a case draft: edits, validation from the shared
 * schema, server field errors, saving with the revision, and the imported
 * answers saved beside it. Warns before leaving with unsaved edits.
 */

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { SaveState } from '@/components/feedback/SaveIndicator'
import type { FieldErrors } from '@/components/evaluations/DraftEditor'
import type { SavedImport } from '@/components/evaluations/ImportedAnswers'
import { draftInputSchema, type DraftInput } from '@/domain/contracts'
import { api, ApiClientError, describeError } from '@/lib/api-client'
import type { OwnerEvaluationView } from '@/lib/dto'
import { useUnsavedChangesWarning } from '@/lib/use-unsaved-changes'

function toFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiClientError)) return {}
  return Object.fromEntries(error.fields.map((field) => [field.path, field.message]))
}

export function useCaseDraft(evaluation: OwnerEvaluationView) {
  const [draft, setDraft] = useState<DraftInput>(() => ({ comparisonMode: evaluation.draft.comparisonMode, ...(evaluation.draft.rubricVersion ? { rubricVersion: evaluation.draft.rubricVersion } : {}), cases: evaluation.draft.cases, configurations: evaluation.draft.configurations }))
  const [revision, setRevision] = useState(evaluation.revision)
  const [imports, setImports] = useState<SavedImport[]>(() => evaluation.imports.map((item) => ({ configurationKey: item.configurationKey, caseKey: item.caseKey, text: item.text })))
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  useUnsavedChangesWarning(dirty)

  const change = (next: DraftInput) => {
    setDraft(next)
    setDirty(true)
    setSaveState('idle')
  }

  const clientErrors = useMemo<FieldErrors>(() => {
    const parsed = draftInputSchema.safeParse(draft)
    return parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
  }, [draft])

  const save = useCallback(async () => {
    setSaveState('saving')
    try {
      const result = await api<{ revision: number }>('PUT', `/evaluations/${evaluation.id}/draft`, { body: draft, revision })
      setRevision(result.revision)
      setDirty(false)
      setServerErrors({})
      setSaveState('saved')
    } catch (caught) {
      setServerErrors(toFieldErrors(caught))
      setSaveState(caught instanceof ApiClientError && caught.code === 'REVISION_CONFLICT' ? 'conflict' : 'error')
      if (!(caught instanceof ApiClientError && caught.fields.length)) toast.error(describeError(caught))
    }
  }, [draft, evaluation.id, revision])

  /** Record a party's saved imported answers and the revision they produced. */
  const importsSaved = (configurationKey: string, nextRevision: number, items: SavedImport[]) => {
    setRevision(nextRevision)
    setImports((current) => [...current.filter((item) => item.configurationKey !== configurationKey), ...items])
  }

  return {
    draft,
    change,
    revision,
    imports,
    importsSaved,
    dirty,
    saveState,
    save,
    errors: { ...serverErrors, ...clientErrors },
    hasErrors: Object.keys(clientErrors).length > 0,
  }
}
