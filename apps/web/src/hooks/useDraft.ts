import { useCallback, useState } from 'react'

function read<T>(key: string): T | null {
  try {
    const stored = sessionStorage.getItem(key)
    return stored === null ? null : (JSON.parse(stored) as T)
  } catch {
    // Storage can be unavailable (private mode) or hold something unreadable; start clean.
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A full or blocked storage only costs the safety net, not the edit itself.
  }
}

export interface Draft<T> {
  value: T
  /** True when the value came from storage: the user left this form with unsaved changes. */
  restored: boolean
  set(next: T): void
  /** Forgets the stored copy and goes back to `initial`. */
  discard(): void
  /** Forgets the stored copy but keeps the current value, e.g. after a successful save. */
  clear(): void
}

/**
 * Form state that survives leaving the page within the same browser tab. Whatever differs
 * from `initial` is kept in sessionStorage under `key` and offered back on return.
 */
export function useDraft<T>(key: string, initial: T): Draft<T> {
  const [state, setState] = useState(() => {
    const stored = read<T>(key)
    return { value: stored ?? initial, restored: stored !== null }
  })

  const set = useCallback(
    (next: T) => {
      write(key, JSON.stringify(next) === JSON.stringify(initial) ? null : next)
      setState((current) => ({ ...current, value: next }))
    },
    [key, initial],
  )
  const discard = useCallback(() => {
    write(key, null)
    setState({ value: initial, restored: false })
  }, [key, initial])
  const clear = useCallback(() => write(key, null), [key])

  return { ...state, set, discard, clear }
}
