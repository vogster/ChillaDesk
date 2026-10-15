import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { fetchVersionInfo } from '../../api/version'

/** The server looks twice a day; once an hour is often enough to ask it. */
export const useVersionInfo = () =>
  useQuery({
    queryKey: ['version'],
    queryFn: fetchVersionInfo,
    staleTime: 60 * 60 * 1000,
    retry: false,
  })

const DISMISSED_KEY = 'cw_dismissed_update'
const listeners = new Set<() => void>()

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

let dismissedNow = readDismissed()

function dismissUpdate(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version)
  } catch {
    // Private mode: the reminder is put away for this visit only.
  }
  dismissedNow = version
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The version whose reminder was put away, kept in this browser and shared by every place
 * that shows the reminder; a newer version brings it back.
 */
export function useDismissedUpdate(): [string | null, (version: string) => void] {
  const dismissed = useSyncExternalStore(subscribe, () => dismissedNow)
  return [dismissed, dismissUpdate]
}
