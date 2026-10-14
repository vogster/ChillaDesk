import { liveResourceSchema, type LiveEvent, type LiveResource } from '@chilladesk/shared'
import { z } from 'zod'
import { RELAY_PAYLOAD_MAX, type Relay } from '../../db/client'

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
  /**
   * Carries events to every API replica. Without it events reach only the streams open on
   * this process, which is all there is with a single replica.
   */
  relay?: Relay | null
  onError?(error: unknown): void
}

export interface EventBus {
  /** Starts hearing events from the other replicas; the returned function stops it. */
  connect(): Promise<() => Promise<void>>
  /** Registers a stream; the returned function removes it again. */
  subscribe(subscriber: Subscriber): () => void
  /** Tells the connected members of a project that something in it changed. */
  publishProject(projectId: string, resource: LiveResource): Promise<void>
  /** Tells these users that the set of projects they can see has changed. */
  publishAccessChange(userIds: string[]): void
  /** Number of streams the user has open. */
  countOf(userId: string): number
  /** Number of open streams. */
  readonly size: number
  closeAll(): void
}

/** What replicas tell each other: short keys, as a notification holds at most 8000 bytes. */
const relayMessageSchema = z.union([
  z.object({ p: z.uuid(), r: liveResourceSchema }),
  z.object({ a: z.array(z.uuid()) }),
])
type RelayMessage = z.infer<typeof relayMessageSchema>

/** User ids in messages small enough for one notification each. */
function accessMessages(userIds: string[]): RelayMessage[] {
  // A UUID with its quotes and comma is 39 bytes.
  const perMessage = Math.floor((RELAY_PAYLOAD_MAX - 16) / 39)
  const messages: RelayMessage[] = []
  for (let start = 0; start < userIds.length; start += perMessage) {
    messages.push({ a: userIds.slice(start, start + perMessage) })
  }
  return messages
}

/**
 * Delivers events to the streams open on this API process, and, given a relay, passes them
 * through the database so that every replica delivers them to its own streams.
 */
export function createEventBus({ membersAmong, relay, onError }: EventBusOptions): EventBus {
  const subscribers = new Set<Subscriber>()
  // Until the relay is listening, events are delivered here directly so none is lost.
  let listening = false

  async function deliverProject(projectId: string, resource: LiveResource): Promise<void> {
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
  }

  function deliverAccess(userIds: string[]): void {
    const affected = new Set(userIds)
    for (const subscriber of subscribers) {
      if (affected.has(subscriber.userId)) subscriber.send({ type: 'access_changed' })
    }
  }

  function receive(payload: string): void {
    let message: RelayMessage
    try {
      message = relayMessageSchema.parse(JSON.parse(payload))
    } catch (error) {
      onError?.(error)
      return
    }
    if ('p' in message) void deliverProject(message.p, message.r)
    else deliverAccess(message.a)
  }

  /** Sends through the relay; if that fails, at least this replica's streams hear of it. */
  async function relayOr(messages: RelayMessage[], deliverHere: () => unknown): Promise<void> {
    if (!relay || !listening) {
      await deliverHere()
      return
    }
    try {
      for (const message of messages) await relay.publish(JSON.stringify(message))
    } catch (error) {
      onError?.(error)
      await deliverHere()
    }
  }

  return {
    async connect() {
      if (!relay) return async () => undefined
      const stop = await relay.subscribe(receive)
      listening = true
      return async () => {
        listening = false
        await stop()
      }
    },

    subscribe(subscriber) {
      subscribers.add(subscriber)
      return () => void subscribers.delete(subscriber)
    },

    publishProject(projectId, resource) {
      return relayOr([{ p: projectId, r: resource }], () => deliverProject(projectId, resource))
    },

    publishAccessChange(userIds) {
      if (userIds.length === 0) return
      void relayOr(accessMessages(userIds), () => deliverAccess(userIds))
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
