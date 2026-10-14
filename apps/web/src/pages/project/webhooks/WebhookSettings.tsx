import {
  createWebhookRequestSchema,
  webhookEventSchema,
  webhookFormatSchema,
  type CreatedWebhook,
  type Webhook,
  type WebhookFormat,
} from '@chilladesk/shared'
import { useId, useState, type FormEvent } from 'react'
import { errorMessage } from '../../../api/client'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../../../components/form'
import { Alert, Button, Card, selectClass, Spinner, TextField } from '../../../components/ui'
import { intlLocale, useT } from '../../../i18n'
import { useWebhookMutations, useWebhooks } from './webhookQueries'

const DEFAULT_EVENTS = ['task.created', 'task.updated', 'comment.created'] as const

/** The address without its path, which for Slack and Telegram holds the secret. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })

function WebhookItem({
  webhook,
  onToggle,
  onTest,
  onRemove,
  busy,
}: {
  webhook: Webhook
  onToggle: (active: boolean) => void
  onTest: () => void
  onRemove: () => void
  busy: boolean
}) {
  const t = useT()
  const text = t.project.webhooks
  const translate = (message: string) => t.common.errors.serverText(message) ?? message
  const last = webhook.lastDelivery
  const host = hostOf(webhook.url)

  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium break-all">{host}</span>
        <span className="rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800">
          {text.formatShort[webhook.format]}
        </span>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={webhook.active}
            disabled={busy}
            onChange={(event) => onToggle(event.target.checked)}
          />
          {text.active}
        </label>
        <Button variant="secondary" onClick={onTest} disabled={busy || !webhook.active}>
          {text.sendTest}
        </Button>
        <Button
          variant="secondary"
          onClick={onRemove}
          disabled={busy}
          aria-label={text.deleteOf(host)}
        >
          {t.common.delete}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {webhook.events.map((event) => text.events[event]).join(', ')}
      </p>
      <p className="text-xs text-slate-500">
        {!last && text.noDeliveries}
        {last?.status === 'delivered' && text.delivered(when(last.lastAttemptAt ?? last.createdAt))}
        {last?.status === 'pending' &&
          (last.error ? text.retrying(translate(last.error)) : text.waiting)}
        {last?.status === 'failed' && text.failed(translate(last.error ?? ''))}
      </p>
    </li>
  )
}

/** Owner settings: addresses told about what happens in the project. */
export function WebhookSettings({ projectId }: { projectId: string }) {
  const t = useT()
  const text = t.project.webhooks
  const webhooks = useWebhooks(projectId)
  const { create, update, remove, test } = useWebhookMutations(projectId)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [created, setCreated] = useState<CreatedWebhook | null>(null)
  const [format, setFormat] = useState<WebhookFormat>('json')
  const formatId = useId()
  const mutations = [create, update, remove, test]
  const actionError = mutations.find((mutation) => mutation.error)?.error
  const busy = mutations.some((mutation) => mutation.isPending)
  const clearErrors = () => mutations.forEach((mutation) => mutation.reset())

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const parsed = parseForm(createWebhookRequestSchema, {
      url: String(form.get('url') ?? ''),
      format,
      events: form.getAll('events').map(String),
    })
    clearErrors()
    setCreated(null)
    if (!parsed.ok) {
      setFieldErrors(parsed.errors)
      focusFirstInvalid(formElement, parsed.errors)
      return
    }
    setFieldErrors({})
    create.mutate(parsed.data, {
      onSuccess: (webhook) => {
        setCreated(webhook)
        formElement.reset()
        setFormat('json')
      },
    })
  }

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">{text.heading}</h2>
      <p className="mb-4 text-sm text-slate-500">{text.hint}</p>
      {actionError && (
        <div className="mb-4">
          <Alert>{errorMessage(actionError)}</Alert>
        </div>
      )}
      {created && (
        <div
          role="status"
          className="mb-4 space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950"
        >
          <p>{text.secretOnce}</p>
          <code className="block break-all select-all">{created.secret}</code>
        </div>
      )}
      {webhooks.isPending && <Spinner />}
      {webhooks.isError && <Alert>{errorMessage(webhooks.error)}</Alert>}
      {webhooks.isSuccess && webhooks.data.length === 0 && (
        <p className="text-sm text-slate-500">{text.empty}</p>
      )}
      {webhooks.isSuccess && webhooks.data.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {webhooks.data.map((webhook) => (
            <WebhookItem
              key={webhook.id}
              webhook={webhook}
              busy={busy}
              onToggle={(active) => {
                clearErrors()
                update.mutate({ webhookId: webhook.id, patch: { active } })
              }}
              onTest={() => {
                clearErrors()
                test.mutate(webhook.id)
              }}
              onRemove={() => {
                clearErrors()
                remove.mutate(webhook.id)
              }}
            />
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} noValidate className="mt-6 space-y-3">
        <h3 className="text-sm font-semibold">{text.add}</h3>
        <TextField
          label={text.url}
          name="url"
          type="url"
          placeholder={text.urlPlaceholder[format]}
          hint={text.urlHint[format]}
          error={fieldErrors.url}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={formatId} className="text-sm font-medium">
            {text.format}
          </label>
          <select
            id={formatId}
            value={format}
            onChange={(event) => setFormat(webhookFormatSchema.parse(event.target.value))}
            className={selectClass}
          >
            {webhookFormatSchema.options.map((option) => (
              <option key={option} value={option}>
                {text.formats[option]}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">{text.eventsLabel}</legend>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {webhookEventSchema.options.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="events"
                  value={event}
                  defaultChecked={(DEFAULT_EVENTS as readonly string[]).includes(event)}
                />
                {text.events[event]}
              </label>
            ))}
          </div>
          {fieldErrors.events && (
            <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
              {fieldErrors.events}
            </p>
          )}
        </fieldset>
        <Button type="submit" disabled={create.isPending}>
          {text.addButton}
        </Button>
      </form>
    </Card>
  )
}
