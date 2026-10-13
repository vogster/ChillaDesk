import { attachmentSchema, type Attachment } from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useRef, useState, type ChangeEvent } from 'react'
import { z } from 'zod'
import { apiRequest, errorMessage, uploadFile } from '../api/client'
import { useT } from '../i18n'
import { Alert, Button } from './ui'

interface AttachmentsProps {
  /** API path of the list, e.g. `/projects/<id>/tasks/<id>/attachments`. */
  path: string
  queryKey: QueryKey
  canEdit: boolean
}

/** What to paste into Markdown to show the picture in a description, comment or page. */
export const markdownImage = ({ fileName, url }: Attachment) =>
  `![${fileName.replace(/[[\]\\]/g, '')}](${url})`

function AttachmentItem({
  attachment,
  canEdit,
  onRemove,
}: {
  attachment: Attachment
  canEdit: boolean
  onRemove: () => void
}) {
  const t = useT()
  const texts = t.common.attachments
  const [copied, setCopied] = useState(false)

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdownImage(attachment))
      setCopied(true)
    } catch {
      // No clipboard access: nothing was copied, and the button says so by not changing.
      setCopied(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {attachment.isImage && (
        <img
          src={attachment.url}
          alt=""
          loading="lazy"
          className="size-10 rounded border border-slate-200 object-cover dark:border-slate-700"
        />
      )}
      <a
        href={attachment.url}
        download={attachment.fileName}
        className="min-w-0 break-all text-indigo-600 hover:underline dark:text-indigo-400"
      >
        {attachment.fileName}
      </a>
      <span className="text-xs text-slate-500">{texts.size(attachment.size)}</span>
      <span className="ml-auto flex gap-3">
        {attachment.isImage && (
          <button
            type="button"
            onClick={() => void copyMarkdown()}
            aria-label={texts.copyMarkdownLabel(attachment.fileName)}
            className="text-xs text-slate-500 hover:underline"
          >
            {copied ? texts.copied : texts.copyMarkdown}
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={texts.removeLabel(attachment.fileName)}
            className="text-xs text-slate-500 hover:text-red-600 hover:underline"
          >
            {t.common.delete}
          </button>
        )}
      </span>
    </li>
  )
}

/** The files attached to a task or a wiki page: download, attach more, remove. */
export function Attachments({ path, queryKey, canEdit }: AttachmentsProps) {
  const texts = useT().common.attachments
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const attachments = useQuery({
    queryKey,
    queryFn: () => apiRequest(path, { schema: z.array(attachmentSchema) }),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey })
  const upload = useMutation({
    // One after another: a failure names the file it stopped at and keeps what went before.
    mutationFn: async (files: File[]) => {
      for (const file of files) await uploadFile(path, file, attachmentSchema)
    },
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (attachmentId: string) =>
      apiRequest(`${path}/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })
  const error = upload.error ?? remove.error

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    // Emptied so that choosing the same file again is noticed.
    event.target.value = ''
    if (files.length === 0) return
    remove.reset()
    upload.mutate(files)
  }

  const items = attachments.data ?? []
  if (!canEdit && items.length === 0) return null

  return (
    <section aria-labelledby="attachments-heading" className="space-y-2">
      <h3 id="attachments-heading" className="text-sm font-semibold">
        {texts.heading}
      </h3>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              canEdit={canEdit}
              onRemove={() => {
                upload.reset()
                remove.mutate(attachment.id)
              }}
            />
          ))}
        </ul>
      )}
      {canEdit && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            aria-label={texts.attach}
            tabIndex={-1}
            onChange={handleFiles}
          />
          <Button
            variant="secondary"
            disabled={upload.isPending}
            onClick={() => input.current?.click()}
          >
            {upload.isPending ? texts.uploading : texts.attach}
          </Button>
        </>
      )}
    </section>
  )
}
