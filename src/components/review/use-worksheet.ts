/**
 * A juror's worksheet state: ratings by response, autosave 800 ms after the
 * last edit, the session revision returned by the latest save, and filing.
 * Filing waits for any save in flight and refuses when the latest edits
 * could not be saved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { SaveState } from '@/components/feedback/SaveIndicator'
import type { DraftRating } from '@/domain/contracts'
import { DIMENSIONS, submissionIssues } from '@/domain/rubric'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { AnonymousReview } from '@/lib/dto'
import { useUnsavedChangesWarning } from '@/lib/use-unsaved-changes'

const AUTOSAVE_MS = 800

export function isComplete(rating: DraftRating | undefined): boolean {
  return !!rating && DIMENSIONS.every((d) => rating[d] !== null)
}

export function useWorksheet(review: AnonymousReview, reload: () => Promise<void>) {
  const editable = review.sessionStatus === 'draft' && review.runStatus === 'reviewing'
  const [ratings, setRatings] = useState<Record<string, DraftRating>>(() => Object.fromEntries(review.ratings.map((r) => [r.responseId, r])))
  // The session revision is a ref: filing must use the value returned by the latest save.
  const revision = useRef(review.sessionRevision)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [dirty, setDirty] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const saving = useRef<Promise<boolean> | null>(null)
  const submitKey = useRef<string>(newIntentKey())
  useUnsavedChangesWarning(dirty)

  const assigned = useMemo(() => review.cases.flatMap((c) => c.responses.map((r) => r.responseId)), [review.cases])
  const ratingList = useMemo(() => assigned.filter((id) => ratings[id]).map((id) => ratings[id]), [assigned, ratings])
  const issues = useMemo(() => submissionIssues(assigned, ratingList), [assigned, ratingList])
  const scored = assigned.filter((id) => isComplete(ratings[id])).length

  const save = useCallback(async (): Promise<boolean> => {
    if (!editable) return true
    if (saving.current) await saving.current
    const run = (async () => {
      setSaveState('saving')
      try {
        const result = await api<{ sessionRevision: number }>('PUT', `/runs/${review.runId}/review`, { body: { ratings: ratingList }, revision: revision.current })
        revision.current = result.sessionRevision
        setDirty(false)
        setSaveState('saved')
        return true
      } catch (caught) {
        setSaveState(caught instanceof ApiClientError && caught.code === 'REVISION_CONFLICT' ? 'conflict' : 'error')
        return false
      } finally {
        saving.current = null
      }
    })()
    saving.current = run
    return run
  }, [editable, ratingList, review.runId])

  useEffect(() => {
    if (!dirty || saveState === 'conflict') return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS)
    return () => window.clearTimeout(timer.current)
  }, [dirty, save, saveState])

  const update = (next: DraftRating) => {
    setRatings((current) => ({ ...current, [next.responseId]: next }))
    setDirty(true)
    if (saveState !== 'conflict') setSaveState('idle')
  }

  /** Save pending edits before moving to another question. */
  const flush = async () => {
    if (dirty) await save()
  }

  /**
   * File the worksheet. `unseal` (a judge with no jury) also unseals the
   * record in the same commit. Resolves true when it went through.
   */
  const submit = async (options: { unseal?: boolean } = {}): Promise<boolean> => {
    setSubmitting(true)
    try {
      if (saving.current) await saving.current
      if (dirty && !(await save())) throw new ApiClientError(409, 'NOT_SAVED', 'Your latest ratings could not be saved yet, so nothing was submitted.')
      const action = options.unseal ? 'file-and-unseal' : 'submit'
      await api('POST', `/runs/${review.runId}/review/${action}`, { body: {}, revision: revision.current, idempotencyKey: submitKey.current })
      toast.success(options.unseal ? 'Findings filed and the record unsealed' : 'Findings filed')
      await reload()
      return true
    } catch (caught) {
      toast.error(describeError(caught))
      submitKey.current = newIntentKey()
      return false
    } finally {
      setSubmitting(false)
    }
  }

  return { editable, ratings, update, saveState, save, flush, submit, submitting, issues, scored, total: assigned.length }
}
