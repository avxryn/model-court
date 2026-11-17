/**
 * Minimal authorized data loading: keeps the last good data (labelled stale)
 * on a failed refresh, refetches on focus, and optionally on an interval.
 * Saved server data stays authoritative; this is a cache of one response.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiClientError } from './api-client'

export interface ApiResource<T> {
  data: T | null
  error: ApiClientError | null
  loading: boolean
  /** True when `data` is from an earlier successful load and the latest refresh failed. */
  stale: boolean
  reload: () => Promise<void>
}

export function useApi<T>(path: string | null, options: { pollMs?: number } = {}): ApiResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiClientError | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const inflight = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    if (!path) return
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    try {
      const next = await api<T>('GET', path, { signal: controller.signal })
      if (controller.signal.aborted) return
      setData(next)
      setError(null)
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return
      setError(caught instanceof ApiClientError ? caught : new ApiClientError(0, 'UNKNOWN', 'Something went wrong.'))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    setData(null)
    setError(null)
    setLoading(path !== null)
    void reload()
    return () => inflight.current?.abort()
  }, [path, reload])

  useEffect(() => {
    const onFocus = () => void reload()
    window.addEventListener('focus', onFocus)
    const timer = options.pollMs ? window.setInterval(() => void reload(), options.pollMs) : undefined
    return () => {
      window.removeEventListener('focus', onFocus)
      if (timer) window.clearInterval(timer)
    }
  }, [reload, options.pollMs])

  return { data, error, loading, stale: data !== null && error !== null, reload }
}
