import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { friendlyError, logError } from '../lib/errors'

export type AsyncState<T> = { data: T | undefined; error: string; loading: boolean; reload: () => void; setData: (value: T | ((prev: T | undefined) => T | undefined)) => void }

/** Loads data, ignores stale responses, and exposes a user-safe error message. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList, enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(enabled)
  const [tick, setTick] = useState(0)
  const runId = useRef(0)

  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    const id = ++runId.current
    setLoading(true)
    load().then((result) => { if (id === runId.current) { setData(result); setError(''); setLoading(false) } })
      .catch((err) => { if (id === runId.current) { logError('load', err); setError(friendlyError(err, 'We could not load this. Please try again.')); setLoading(false) } })
    return () => { runId.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data, error, loading, reload, setData }
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const id = window.setTimeout(() => setDebounced(value), delay); return () => window.clearTimeout(id) }, [value, delay])
  return debounced
}
