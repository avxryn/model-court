/**
 * The docket list with "Load more": the first page comes from useApi (so it
 * refreshes on focus and reports stale data), older pages are appended on
 * request. Rows are deduplicated by id, the first page's copy winning, and
 * kept in last-activity order.
 */

import { useMemo, useState } from 'react'
import { api, describeError } from '@/lib/api-client'
import type { EvaluationSummary } from '@/lib/dto'
import { useApi } from '@/lib/use-api'

interface DocketPage {
  items: EvaluationSummary[]
  nextCursor: string | null
}

const PAGE = 20

export function useDocket() {
  const first = useApi<DocketPage>(`/evaluations?limit=${PAGE}`)
  const [older, setOlder] = useState<DocketPage | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)

  const items = useMemo(() => {
    const seen = new Map<string, EvaluationSummary>()
    for (const item of [...(first.data?.items ?? []), ...(older?.items ?? [])]) if (!seen.has(item.id)) seen.set(item.id, item)
    return [...seen.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [first.data, older])

  const nextCursor = older ? older.nextCursor : (first.data?.nextCursor ?? null)

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await api<DocketPage>('GET', `/evaluations?limit=${PAGE}&cursor=${encodeURIComponent(nextCursor)}`)
      setOlder((prev) => ({ items: [...(prev?.items ?? []), ...page.items], nextCursor: page.nextCursor }))
    } catch (error) {
      setMoreError(describeError(error))
    } finally {
      setLoadingMore(false)
    }
  }

  return { first, items, hasMore: nextCursor !== null, loadMore, loadingMore, moreError }
}
