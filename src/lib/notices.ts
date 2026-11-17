/**
 * Live invalidation (F16): subscribe to the caller's own safe notice rows via
 * the DeepSpace RecordRoom and refetch authorized data when one changes. A
 * notice carries only IDs and a timestamp; it never authorizes anything.
 */

import { useEffect, useRef } from 'react'
import { useQuery } from 'deepspace'
import { NOTICES_COLLECTION } from '@/schemas/notices-schema'

interface Notice {
  recipientUserId: string
  evaluationId: string
  runId: string | null
  revision: number
}

/** Calls `onChange` when a notice for `runId` (or any, when null) gets a newer revision. */
export function useNoticeRefresh(runId: string | null, onChange: () => void): { live: boolean } {
  const { records, status } = useQuery<Notice>(NOTICES_COLLECTION, runId ? { where: { runId } } : undefined)
  const seen = useRef<number | null>(null)
  const latest = records.reduce((max, record) => Math.max(max, record.data.revision ?? 0), 0)

  useEffect(() => {
    if (status !== 'ready') return
    // Ignore the initial snapshot; react only to later, higher revisions.
    if (seen.current !== null && latest > seen.current) onChange()
    if (seen.current === null || latest > seen.current) seen.current = latest
  }, [latest, status, onChange])

  return { live: status === 'ready' }
}
