import type { LiveEvent, LiveResource } from '@chilladesk/shared'

/** One open event stream. */
export interface Subscriber {
  userId: string
  send(event: LiveEvent): void
  /** Ends the stream; called when the server drops it. */
  close(): void
}

export interface EventBusOptions {
  /** Of the given users, those who are members of the project. */
  membersAmong(projectId: string, userIds: string[]): Promise<string[]>
  onError?(error: unknown): void
}

export interface EventBus {
  /** Registers a stream; the returned function removes it again. */
  subscribe(subscriber: Subscriber): () => void
  /** Tells the connected members of a project that something in it changed. */
  publishProject(projectId: string, resource: LiveResource): Promise<void>
  /** Number of streams the user has open. */
  countOf(userId: string): number
  /** Number of open streams. */
  readonly size: number
  closeAll(): void
}

/**
 * Delivers events to the streams open on this API process. With several API replicas a
 * client only hears about changes made through the replica it is connected to.
 */
export function createEventBus({ membersAmong, onError }: EventBusOptions): EventBus {
  const subscribers = new Set<Subscriber>()

  return {
    subscribe(subscriber) {
      subscribers.add(subscriber)
      return () => void subscribers.delete(subscriber)
    },

    async publishProject(projectId, resource) {
      const connected = [...new Set([...subscribers].map((item) => item.userId))]
      if (connected.length === 0) return
      try {
        // Asked at the moment of the event, so someone removed from the project hears no more.
        const members = new Set(await membersAmong(projectId, connected))
        for (const subscriber of subscribers) {
          if (members.has(subscriber.userId)) {
            subscriber.send({ type: 'project_changed', projectId, resource })
          }
        }
      } catch (error) {
        // A missed event costs a stale screen; it must never fail the request that caused it.
        onError?.(error)
      }
    },

    countOf(userId) {
      return [...subscribers].filter((item) => item.userId === userId).length
    },

    get size() {
      return subscribers.size
    },

    closeAll() {
      for (const subscriber of [...subscribers]) {
        subscribers.delete(subscriber)
        subscriber.close()
      }
    },
  }
}
