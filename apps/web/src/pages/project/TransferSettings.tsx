import { importFormatSchema, type ImportFormat } from '@chilladesk/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { errorMessage } from '../../api/client'
import { exportUrl, importTasks } from '../../api/transfer'
import { Alert, Button, Card, selectClass } from '../../components/ui'
import { useT } from '../../i18n'

const LINK_CLASS = 'text-indigo-600 hover:underline dark:text-indigo-400'

/** Owner settings: download tasks and wiki, bring tasks in from a file. */
export function TransferSettings({ projectId }: { projectId: string }) {
  const t = useT()
  const text = t.project.transfer
  const translate = (message: string) => t.common.errors.serverText(message) ?? message
  const queryClient = useQueryClient()
  const formatId = useId()
  const fileId = useId()
  const [format, setFormat] = useState<ImportFormat>('csv')
  const [file, setFile] = useState<File | null>(null)

  const run = useMutation({
    mutationFn: (chosen: File) => importTasks(projectId, chosen, format),
    // Tasks, columns, labels and milestones may all have changed.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId] }),
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (file) run.mutate(file)
  }

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">{text.heading}</h2>
      <p className="mb-3 text-sm text-slate-500">{text.exportHint}</p>
      <ul className="mb-6 space-y-1 text-sm">
        <li>
          <a href={exportUrl(projectId, 'tasks.csv')} download className={LINK_CLASS}>
            {text.exportTasks}
          </a>
        </li>
        <li>
          <a href={exportUrl(projectId, 'wiki.zip')} download className={LINK_CLASS}>
            {text.exportWiki}
          </a>
        </li>
      </ul>

      <h3 className="mb-1 text-sm font-semibold">{text.importHeading}</h3>
      <p className="mb-3 text-sm text-slate-500">{text.importHint}</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={formatId} className="text-sm font-medium">
            {text.format}
          </label>
          <select
            id={formatId}
            value={format}
            onChange={(event) => setFormat(importFormatSchema.parse(event.target.value))}
            className={selectClass}
          >
            {importFormatSchema.options.map((option) => (
              <option key={option} value={option}>
                {text.formats[option]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={fileId} className="text-sm font-medium">
            {text.file}
          </label>
          <input
            id={fileId}
            type="file"
            accept={format === 'trello' ? '.json,application/json' : '.csv,.tsv,.txt,text/csv'}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              run.reset()
            }}
            className="text-sm"
          />
        </div>
        <Button type="submit" disabled={!file || run.isPending}>
          {run.isPending ? text.importing : text.import}
        </Button>
      </form>

      {run.isError && (
        <div className="mt-4">
          <Alert>{errorMessage(run.error)}</Alert>
        </div>
      )}
      {run.isSuccess && (
        <div role="status" className="mt-4 space-y-3 text-sm">
          <p className="font-medium">{text.created(run.data.created)}</p>
          {run.data.skipped.length > 0 && (
            <div>
              <h4 className="font-medium">{text.skippedHeading}</h4>
              <ul className="list-disc pl-5 text-slate-600 dark:text-slate-400">
                {run.data.skipped.map((item) => (
                  <li key={item.row}>
                    {text.row(item.row)}: {translate(item.reason)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {run.data.warnings.length > 0 && (
            <div>
              <h4 className="font-medium">{text.warningsHeading}</h4>
              <ul className="list-disc pl-5 text-slate-600 dark:text-slate-400">
                {run.data.warnings.map((warning) => (
                  <li key={warning}>{translate(warning)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
