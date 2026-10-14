import { z } from 'zod'
import { textSchema } from './auth'

/** What happened in a project that a webhook can be told about. */
export const webhookEventSchema = z.enum([
  'task.created',
  'task.updated',
  'task.deleted',
  'comment.created',
  'page.created',
  'page.updated',
  'page.deleted',
])
export type WebhookEvent = z.infer<typeof webhookEventSchema>

/**
 * How a delivery is written: `json` is the full event, signed; `slack` and `telegram` are a
 * line of text in the body those services take (Discord takes `slack` at its `/slack` URL).
 */
export const webhookFormatSchema = z.enum(['json', 'slack', 'telegram'])
export type WebhookFormat = z.infer<typeof webhookFormatSchema>

/** Webhooks one project can have. */
export const WEBHOOKS_PER_PROJECT_MAX = 10

export const webhookUrlSchema = textSchema
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https?$/, error: 'Must be an http:// or https:// address' }))

const webhookEventsSchema = z
  .array(webhookEventSchema)
  .min(1, 'Choose at least one event')
  .refine((events) => new Set(events).size === events.length, 'Events must not repeat')

export const deliveryStatusSchema = z.enum(['pending', 'delivered', 'failed'])
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>

/** One attempt to tell a webhook about an event, and how it went. */
export const webhookDeliverySchema = z.object({
  id: z.uuid(),
  /** `ping` for a test sent from the settings. */
  event: z.union([webhookEventSchema, z.literal('ping')]),
  status: deliveryStatusSchema,
  attempts: z.number().int().min(0),
  /** The HTTP status the receiver answered with, if it answered. */
  responseStatus: z.number().int().nullable(),
  /** Why the last attempt failed. */
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** When it last went out, or null before the first attempt. */
  lastAttemptAt: z.iso.datetime().nullable(),
})
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>

export const webhookSchema = z.object({
  id: z.uuid(),
  /**
   * The address with its path masked (`https://hooks.slack.com/…a1b2`): for Slack, Discord
   * and Telegram the path is a key. It is sent in full only when it is set.
   */
  url: z.string(),
  format: webhookFormatSchema,
  events: z.array(webhookEventSchema),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  lastDelivery: webhookDeliverySchema.nullable(),
})
export type Webhook = z.infer<typeof webhookSchema>

/** A new webhook, with the secret its deliveries are signed with; shown this once only. */
export const createdWebhookSchema = webhookSchema.extend({ secret: z.string() })
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>

export const createWebhookRequestSchema = z.object({
  url: webhookUrlSchema,
  format: webhookFormatSchema.default('json'),
  events: webhookEventsSchema,
})
export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>

export const updateWebhookRequestSchema = z
  .object({
    url: webhookUrlSchema.optional(),
    format: webhookFormatSchema.optional(),
    events: webhookEventsSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required')
export type UpdateWebhookRequest = z.infer<typeof updateWebhookRequestSchema>
