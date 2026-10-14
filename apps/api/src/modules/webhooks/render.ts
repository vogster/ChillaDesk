import { createHmac } from 'node:crypto'
import type { TaskChange, WebhookFormat } from '@chilladesk/shared'
import type { WebhookPayload } from './events'

export interface RenderedDelivery {
  body: string
  headers: Record<string, string>
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

function describeChange(change: TaskChange): string {
  switch (change.field) {
    case 'created':
      return 'created'
    case 'description':
      return 'description changed'
    case 'labels':
      return [
        change.added.length ? `labels +${change.added.join(', +')}` : '',
        change.removed.length ? `labels −${change.removed.join(', −')}` : '',
      ]
        .filter(Boolean)
        .join('; ')
    case 'dueDate':
      return `due date ${change.from ?? '—'} → ${change.to ?? '—'}`
    default:
      return `${change.field} ${change.from ?? '—'} → ${change.to ?? '—'}`
  }
}

/** Where the subject of the event opens in the app, when the server knows its address. */
function linkTo(payload: WebhookPayload, publicUrl: string | null): string | null {
  if (!publicUrl) return null
  const base = `${publicUrl.replace(/\/+$/, '')}/projects/${payload.project.id}`
  if (payload.event.endsWith('.deleted')) return base
  if (payload.task) return `${base}/tasks/${payload.task.number}`
  if (payload.page) return `${base}/wiki/${payload.page.id}`
  return base
}

/** The event as a few lines of plain text, for chats. */
export function describeEvent(payload: WebhookPayload, publicUrl: string | null): string {
  const who = oneLine(payload.actor?.name ?? 'Someone')
  const task = payload.task ? `${payload.task.key} ${oneLine(payload.task.title)}` : ''
  const page = payload.page ? `the wiki page “${oneLine(payload.page.title)}”` : ''
  const lines: string[] = []
  switch (payload.event) {
    case 'task.created':
      lines.push(`${who} created ${task}`)
      break
    case 'task.updated':
      lines.push(`${who} updated ${task}`)
      if (payload.changes?.length) lines.push(payload.changes.map(describeChange).join('; '))
      break
    case 'task.deleted':
      lines.push(`${who} deleted ${task}`)
      break
    case 'comment.created':
      lines.push(`${who} commented on ${task}`)
      if (payload.comment) lines.push(shorten(payload.comment.body.trim(), 500))
      break
    case 'page.created':
      lines.push(`${who} created ${page}`)
      break
    case 'page.updated':
      lines.push(`${who} edited ${page}`)
      break
    case 'page.deleted':
      lines.push(`${who} deleted ${page}`)
      break
    case 'ping':
      lines.push(`${who} sent a test message from ChillaDesk`)
      break
  }
  const link = linkTo(payload, publicUrl)
  return [`[${payload.project.key}] ${lines[0] ?? ''}`, ...lines.slice(1), link]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b)

/**
 * Slack reads `<…>` as links and mentions, `&` as the start of an escape: all are escaped.
 * Discord, which takes the same body, pings everyone for `@everyone` and `@here`; a
 * zero-width space after the `@` keeps the words and drops the ping.
 */
const slackText = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(everyone|here)/gi, `@${ZERO_WIDTH_SPACE}$1`)

/**
 * The body and headers of one delivery. Every delivery is signed: the receiver computes
 * HMAC-SHA256 of `<timestamp>.<body>` with the webhook's secret and compares it with the
 * signature header, and refuses old timestamps so a recorded delivery cannot be replayed.
 */
export function renderDelivery(
  payload: WebhookPayload,
  {
    deliveryId,
    format,
    secret,
    publicUrl,
    now = new Date(),
  }: {
    deliveryId: string
    format: WebhookFormat
    secret: string
    publicUrl: string | null
    now?: Date
  },
): RenderedDelivery {
  const text = describeEvent(payload, publicUrl)
  const body =
    format === 'slack'
      ? JSON.stringify({ text: slackText(text) })
      : format === 'telegram'
        ? // Plain text: no parse mode, so nothing in a title can be read as markup.
          JSON.stringify({ text, disable_web_page_preview: true })
        : JSON.stringify({ ...payload, deliveryId, url: linkTo(payload, publicUrl) })
  const timestamp = String(Math.floor(now.getTime() / 1000))
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'ChillaDesk-Webhook',
      'x-chilladesk-event': payload.event,
      'x-chilladesk-delivery': deliveryId,
      'x-chilladesk-timestamp': timestamp,
      'x-chilladesk-signature': `sha256=${signature}`,
    },
  }
}
