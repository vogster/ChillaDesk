import { importResultSchema, type ImportFormat, type ImportResult } from '@chilladesk/shared'
import { uploadFile } from './client'

const base = (projectId: string) => `/projects/${projectId}`

/** Where the browser downloads an export from; a plain link, the session cookie goes along. */
export const exportUrl = (projectId: string, file: 'tasks.csv' | 'wiki.zip') =>
  `/api${base(projectId)}/export/${file}`

export const importTasks = (
  projectId: string,
  file: File,
  format: ImportFormat,
): Promise<ImportResult> =>
  uploadFile(`${base(projectId)}/import/tasks?format=${format}`, file, importResultSchema)
