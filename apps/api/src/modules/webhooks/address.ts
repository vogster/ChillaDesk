import { Resolver } from 'node:dns/promises'
import { Agent as HttpAgent, request as httpRequest } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

/**
 * Addresses a webhook must not reach unless the server allows it: the server itself, the
 * networks it sits in, and what cloud metadata services listen on. Otherwise anyone who can
 * create a project could make the server call into its own network.
 */
const PRIVATE = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  // Unspecified, loopback and the old IPv4-compatible form all fall in here.
  ['::', 96],
  ['::ffff:0:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6')
}

/** Cloud metadata services hand out credentials; they are off limits even on a LAN setup. */
const METADATA = new BlockList()
METADATA.addSubnet('169.254.0.0', 16, 'ipv4')
METADATA.addSubnet('fe80::', 10, 'ipv6')
METADATA.addAddress('fd00:ec2::254', 'ipv6')

/** Whether an IP address is on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  if (family === 6) {
    // An IPv4 address written as IPv6 (`::ffff:10.0.0.1`) is that IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
    if (mapped?.[1]) return isPublicAddress(mapped[1])
    return !PRIVATE.check(address, 'ipv6')
  }
  return !PRIVATE.check(address, 'ipv4')
}

/** Whether a delivery may connect to this IP address. */
function mayConnect(address: string, allowPrivate: boolean): boolean {
  if (!allowPrivate) return isPublicAddress(address)
  const family = isIP(address)
  return family !== 0 && !METADATA.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`${host} is not a public address`)
    this.name = 'BlockedAddressError'
  }
}

/**
 * Names are resolved with c-ares, which has its own timeout, rather than the system
 * resolver: that one runs on the small thread pool password hashing needs too, and a name
 * server that never answers would hold its threads.
 */
const resolver = new Resolver({ timeout: 3000, tries: 2 })

async function resolveAll(hostname: string): Promise<{ address: string; family: 4 | 6 }[]> {
  const [v4, v6] = await Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolve6(hostname),
  ])
  return [
    ...(v4.status === 'fulfilled'
      ? v4.value.map((address) => ({ address, family: 4 as const }))
      : []),
    ...(v6.status === 'fulfilled'
      ? v6.value.map((address) => ({ address, family: 6 as const }))
      : []),
  ]
}

/**
 * Resolves a name the way the connection will use it, and refuses answers it may not
 * reach. Checked here, at connect time, so a name cannot resolve to a public address when
 * checked and to a private one when used.
 */
function checkedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    // Names that mean this machine, whatever a name server would say.
    const name = hostname.toLowerCase()
    if (!allowPrivate && (name === 'localhost' || name.endsWith('.localhost'))) {
      callback(new BlockedAddressError(hostname), '', 0)
      return
    }
    resolveAll(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(Object.assign(new Error(`${hostname} not found`), { code: 'ENOTFOUND' }), '', 0)
          return
        }
        if (addresses.some((entry) => !mayConnect(entry.address, allowPrivate))) {
          callback(new BlockedAddressError(hostname), '', 0)
          return
        }
        if (options.all) {
          ;(callback as unknown as (error: null, list: typeof addresses) => void)(null, addresses)
          return
        }
        const [first] = addresses
        callback(null, first?.address ?? '', first?.family ?? 4)
      },
      (error: unknown) => callback(error as Error, '', 0),
    )
  }
}

/**
 * Agents of their own, so a proxy set up for the rest of the process (`HTTPS_PROXY` with
 * `NODE_USE_ENV_PROXY`) is never used: a proxy would resolve names past the checks above.
 */
const agents = { http: new HttpAgent(), https: new HttpsAgent() }

export interface PostResult {
  status: number
}

export interface PostOptions {
  /** Lets webhooks reach private addresses, for a CI server in the same network. */
  allowPrivate: boolean
  timeoutMs?: number
}

/** Bytes of an answer read before the connection is dropped; nobody reads the rest. */
const MAX_RESPONSE_BYTES = 64 * 1024

/**
 * POSTs a body and resolves with the status of the answer. Redirects are not followed: the
 * new address could be anywhere. The whole exchange is bounded by `timeoutMs`.
 */
export function postWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  { allowPrivate, timeoutMs = 5_000 }: PostOptions,
): Promise<PostResult> {
  const target = new URL(url)
  const host = target.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) !== 0 && !mayConnect(host, allowPrivate)) {
    return Promise.reject(new BlockedAddressError(host))
  }
  const secure = target.protocol === 'https:'
  const request = secure ? httpsRequest : httpRequest

  return new Promise((resolve, reject) => {
    const outgoing = request(
      target,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
        agent: secure ? agents.https : agents.http,
        lookup: checkedLookup(allowPrivate),
        timeout: timeoutMs,
      },
      (response) => {
        let seen = 0
        response.on('data', (chunk: Buffer) => {
          seen += chunk.length
          if (seen > MAX_RESPONSE_BYTES) response.destroy()
        })
        response.on('close', () => resolve({ status: response.statusCode ?? 0 }))
        response.on('error', () => resolve({ status: response.statusCode ?? 0 }))
      },
    )
    const deadline = setTimeout(
      () => outgoing.destroy(new Error(`No answer within ${timeoutMs / 1000} s`)),
      timeoutMs,
    )
    outgoing.on('timeout', () =>
      outgoing.destroy(new Error(`No answer within ${timeoutMs / 1000} s`)),
    )
    outgoing.on('error', (error) => {
      clearTimeout(deadline)
      reject(error)
    })
    outgoing.on('close', () => clearTimeout(deadline))
    outgoing.end(body)
  })
}
