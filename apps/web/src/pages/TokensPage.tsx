import {
  createApiTokenRequestSchema,
  type ApiToken,
  type CreatedApiToken,
} from '@chillawiki/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../api/client'
import { createApiToken, fetchApiTokens, revokeApiToken } from '../api/tokens'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../components/form'
import { Alert, Button, Card, selectClass, Spinner, TextField } from '../components/ui'
import { intlLocale, useT, type Messages } from '../i18n'

type TokenTexts = Messages['shell']['tokens']

const tokensKey = ['api-tokens'] as const

const EXPIRY_OPTIONS = [
  { key: 'days30', days: 30 },
  { key: 'days90', days: 90 },
  { key: 'year', days: 365 },
  { key: 'never', days: null },
] as const

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), { dateStyle: 'medium' })

/** What an MCP client needs to connect, ready to paste into its configuration. */
function mcpConfig(token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        chillawiki: {
          type: 'http',
          url: `${window.location.origin}/api/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const texts = useT().shell.tokens.notice
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard access can be denied; the text is on screen to select by hand.
      setCopied(false)
    }
  }
  return (
    <Button variant="secondary" onClick={() => void copy()}>
      {copied ? texts.copied : label}
    </Button>
  )
}

function NewTokenNotice({
  created,
  onDismiss,
}: {
  created: CreatedApiToken
  onDismiss: () => void
}) {
  const texts = useT().shell.tokens.notice
  return (
    <Card className="border-emerald-300 dark:border-emerald-800">
      <h2 className="text-base font-semibold">{texts.created(created.name)}</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{texts.copyNow}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code
          aria-label={texts.tokenLabel}
          className="min-w-0 flex-1 rounded bg-slate-100 px-2 py-1.5 text-sm break-all dark:bg-slate-800"
        >
          {created.token}
        </code>
        <CopyButton text={created.token} label={texts.copyToken} />
      </div>
      <h3 className="mt-4 text-sm font-semibold">{texts.mcpTitle}</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{texts.mcpHint}</p>
      <pre
        aria-label={texts.configLabel}
        className="mt-2 overflow-x-auto rounded bg-slate-100 p-3 text-xs dark:bg-slate-800"
      >
        {mcpConfig(created.token)}
      </pre>
      <div className="mt-3 flex gap-2">
        <CopyButton text={mcpConfig(created.token)} label={texts.copyConfig} />
        <Button variant="secondary" onClick={onDismiss}>
          {texts.done}
        </Button>
      </div>
    </Card>
  )
}

function expiryText(token: ApiToken, texts: TokenTexts['list']): string {
  if (!token.expiresAt) return texts.noExpiry
  return Date.parse(token.expiresAt) < Date.now()
    ? texts.expired(formatDate(token.expiresAt))
    : texts.expires(formatDate(token.expiresAt))
}

export function TokensPage() {
  const texts = useT().shell.tokens
  const queryClient = useQueryClient()
  const tokens = useQuery({ queryKey: tokensKey, queryFn: fetchApiTokens })
  const refresh = () => queryClient.invalidateQueries({ queryKey: tokensKey })
  const create = useMutation({ mutationFn: createApiToken, onSuccess: refresh })
  const revoke = useMutation({ mutationFn: revokeApiToken, onSuccess: refresh })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [created, setCreated] = useState<CreatedApiToken | null>(null)

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const days = String(form.get('expiry') ?? '')
    const parsed = parseForm(createApiTokenRequestSchema, {
      name: String(form.get('name') ?? ''),
      scope: form.get('scope'),
      expiresInDays: days ? Number(days) : null,
    })
    revoke.reset()
    if (!parsed.ok) {
      create.reset()
      setFieldErrors(parsed.errors)
      focusFirstInvalid(formElement, parsed.errors)
      return
    }
    setFieldErrors({})
    create.mutate(parsed.data, {
      onSuccess: (token) => {
        setCreated(token)
        formElement.reset()
      },
    })
  }

  const actionError = create.error ?? revoke.error

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{texts.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">{texts.intro}</p>
      </div>

      {created && (
        <NewTokenNotice
          created={created}
          onDismiss={() => {
            setCreated(null)
            // The mutation result holds the token too; drop it once the user is done with it.
            create.reset()
          }}
        />
      )}

      <Card>
        <h2 className="mb-4 text-base font-semibold">{texts.form.title}</h2>
        <form onSubmit={handleCreate} noValidate className="flex flex-wrap items-start gap-3">
          <TextField
            label={texts.form.name}
            name="name"
            placeholder={texts.form.namePlaceholder}
            maxLength={60}
            required
            error={fieldErrors.name}
            className="min-w-56 flex-1"
          />
          <div>
            <label htmlFor="token-scope" className="mb-1 block text-sm font-medium">
              {texts.form.access}
            </label>
            <select
              id="token-scope"
              name="scope"
              defaultValue="read"
              className={`${selectClass} py-2`}
            >
              <option value="read">{texts.scope.read}</option>
              <option value="write">{texts.scope.write}</option>
            </select>
          </div>
          <div>
            <label htmlFor="token-expiry" className="mb-1 block text-sm font-medium">
              {texts.form.expires}
            </label>
            <select
              id="token-expiry"
              name="expiry"
              defaultValue="90"
              className={`${selectClass} py-2`}
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.key} value={option.days ?? ''}>
                  {texts.form.expiry[option.key]}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" className="mt-6" disabled={create.isPending}>
            {texts.form.create}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-4 text-base font-semibold">{texts.list.title}</h2>
        {actionError && (
          <div className="mb-4">
            <Alert>{errorMessage(actionError)}</Alert>
          </div>
        )}
        {tokens.isPending && <Spinner />}
        {tokens.isError && <Alert>{errorMessage(tokens.error)}</Alert>}
        {tokens.isSuccess && tokens.data.length === 0 && (
          <p className="text-sm text-slate-500">{texts.list.empty}</p>
        )}
        {tokens.isSuccess && tokens.data.length > 0 && (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {tokens.data.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-slate-500">
                    {texts.scope[token.scope]} · {expiryText(token, texts.list)} ·{' '}
                    {token.lastUsedAt
                      ? texts.list.lastUsed(formatDate(token.lastUsedAt))
                      : texts.list.neverUsed}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={revoke.isPending}
                  aria-label={texts.list.revokeLabel(token.name)}
                  onClick={() => {
                    create.reset()
                    if (created?.id === token.id) setCreated(null)
                    revoke.mutate(token.id)
                  }}
                >
                  {texts.list.revoke}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
