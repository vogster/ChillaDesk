import { liveEventSchema, type LiveEvent, type LiveResource } from '@chilladesk/shared'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

export interface LiveUpdateTiming {
  /**
   * The least time between two reloads. A busy project (a script, an AI assistant) would
   * otherwise make every open screen reload several times a second.
   */
  minIntervalMs: number
  /** First wait before reconnecting after the server refused the stream; doubles each time. */
  retryBaseMs: number
  retryMaxMs: number
}

const DEFAULT_TIMING: LiveUpdateTiming = {
  minIntervalMs: 2000,
  retryBaseMs: 3000,
  retryMaxMs: 60_000,
}

/** What each kind of change makes stale, as query-key suffixes under `['projects', id]`. */
const AFFECTED: Record<LiveResource, string[][]> = {
  project: [[]],
  // Removing a member unassigns their tasks; a deleted column or label changes tasks too.
  members: [['members'], ['tasks']],
  invites: [['invites']],
  statuses: [['statuses'], ['tasks']],
  labels: [['labels'], ['tasks']],
  milestones: [['milestones'], ['tasks']],
  tasks: [['tasks']],
  wiki: [['wiki']],
}

/** Reloads what is on screen of the changed parts, and the lists that span projects. */
function refresh(queryClient: QueryClient, events: LiveEvent[]): void {
  // What the user may see has changed, so nothing on screen can be trusted as it is.
  if (events.some((event) => event.type === 'access_changed')) {
    void queryClient.invalidateQueries()
    return
  }
  const changes = events.filter((event) => event.type === 'project_changed')

  const keys = new Map<string, unknown[]>()
  for (const { projectId, resource } of changes) {
    // A card being dragged is ahead of the server; its own request reloads the board when
    // it settles, and a reload before that would put the card back for a moment.
    const moving = queryClient.isMutating({ mutationKey: ['projects', projectId, 'move-task'] })
    for (const suffix of AFFECTED[resource]) {
      if (moving > 0 && suffix[0] === 'tasks') continue
      const queryKey = ['projects', projectId, ...suffix]
      keys.set(JSON.stringify(queryKey), queryKey)
    }
  }
  for (const queryKey of keys.values()) {
    // Only the project itself is reloaded for a rename, not everything inside it.
    void queryClient.invalidateQueries({ queryKey, exact: queryKey.length === 2 })
  }
  if (changes.some((event) => event.resource === 'project')) {
    void queryClient.invalidateQueries({ queryKey: ['projects'], exact: true })
  }
  for (const queryKey of [['notifications'], ['my-tasks'], ['search']]) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

function parseEvent(data: unknown): LiveEvent | null {
  try {
    const event = liveEventSchema.safeParse(JSON.parse(String(data)))
    return event.success ? event.data : null
  } catch {
    return null
  }
}

/**
 * Keeps the screen current while other people (or an AI assistant) work in the same
 * projects: the server says where something changed and the affected data is loaded again.
 *
 * The stream is only open while the tab is visible. Browsers allow a handful of
 * connections per site, and a stream in every background tab would use them up.
 */
export function useLiveUpdates(timing: Partial<LiveUpdateTiming> = {}): void {
  const queryClient = useQueryClient()
  const { minIntervalMs, retryBaseMs, retryMaxMs } = { ...DEFAULT_TIMING, ...timing }

  useEffect(() => {
    // Not there in very old browsers; the app then simply works without live updates.
    if (typeof EventSource === 'undefined') return

    let source: EventSource | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let pending: LiveEvent[] = []
    let lastRefresh = 0
    let failures = 0
    let connectedBefore = false

    const scheduleRefresh = () => {
      refreshTimer ??= setTimeout(
        () => {
          refreshTimer = undefined
          lastRefresh = Date.now()
          const events = pending
          pending = []
          refresh(queryClient, events)
        },
        Math.max(0, lastRefresh + minIntervalMs - Date.now()),
      )
    }

    const connect = () => {
      const opened = new EventSource('/api/events')
      source = opened
      opened.onopen = () => {
        failures = 0
        // After a gap nobody knows what was missed, so everything on screen is checked again.
        if (connectedBefore) void queryClient.invalidateQueries()
        connectedBefore = true
      }
      opened.onmessage = (message: MessageEvent<unknown>) => {
        const event = parseEvent(message.data)
        if (!event) return
        pending = [...pending, event]
        scheduleRefresh()
      }
      opened.onerror = () => {
        // While it says "connecting" the browser retries by itself. Closed means the server
        // answered with an error (restarting, too many streams), and the browser gave up.
        if (opened.readyState !== EventSource.CLOSED || source !== opened) return
        source = undefined
        const wait = Math.min(retryMaxMs, retryBaseMs * 2 ** failures)
        failures += 1
        // The random part keeps every tab from coming back in the same instant.
        retryTimer = setTimeout(connect, wait * (1 + Math.random() / 2))
      }
    }

    const disconnect = () => {
      clearTimeout(retryTimer)
      retryTimer = undefined
      source?.close()
      source = undefined
    }

    const followVisibility = () => {
      if (document.hidden) disconnect()
      else if (!source) {
        clearTimeout(retryTimer)
        connect()
      }
    }

    followVisibility()
    document.addEventListener('visibilitychange', followVisibility)
    return () => {
      document.removeEventListener('visibilitychange', followVisibility)
      disconnect()
      clearTimeout(refreshTimer)
    }
  }, [queryClient, minIntervalMs, retryBaseMs, retryMaxMs])
}
