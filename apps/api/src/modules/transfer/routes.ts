import {
  errorResponseSchema,
  IMPORT_MAX_BYTES,
  importQuerySchema,
  importResultSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { invalid } from '../../errors'
import { acceptRawBodies } from '../../http/raw-body'
import { requireAuth } from '../auth/plugin'
import { getProject } from '../projects/service'
import { exportTasksCsv, exportWikiZip } from './export.service'
import { importTasks } from './import.service'

export interface TransferRoutesOptions {
  db: Db
  /** Imports, and each kind of export, one client may run per minute. */
  rateLimitMax?: number
}

const projectParams = z.object({ projectId: z.uuid() })
const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

/** A download whose name is made of the project key, which is plain ASCII. */
const download = (fileName: string) => `attachment; filename="${fileName}"`

/** Tasks and wiki out of a project and tasks into it; mounted under `/api/projects/:projectId`. */
export const transferRoutes: FastifyPluginAsyncZod<TransferRoutesOptions> = async (
  app,
  { db, rateLimitMax = 10 },
) => {
  // An import is the raw file; only an owner may send one, checked before it is read.
  acceptRawBodies(app, {
    maxBytes: IMPORT_MAX_BYTES,
    authorize: async (auth, projectId) => {
      await getProject(db, auth.user.id, projectId, 'owner')
    },
  })
  const tags = ['import and export']
  // Each builds a whole file in memory, so one client cannot ask for them back to back.
  const config = { rateLimit: { max: rateLimitMax, timeWindow: '1 minute' } }

  app.get(
    '/export/tasks.csv',
    {
      config,
      schema: {
        tags,
        summary: 'Download all tasks as CSV',
        description: 'The same columns are read back by the import.',
        params: projectParams,
      },
    },
    async (request, reply) => {
      const file = await exportTasksCsv(db, requireAuth(request).user.id, request.params.projectId)
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', download(file.fileName))
        .header('Cache-Control', 'private, no-store')
        .send(file.content)
    },
  )

  app.get(
    '/export/wiki.zip',
    {
      config,
      schema: {
        tags,
        summary: 'Download the wiki as a ZIP of Markdown files',
        description: 'A page is `Title.md`; the pages under it are in the folder `Title/`.',
        params: projectParams,
      },
    },
    async (request, reply) => {
      const file = await exportWikiZip(db, requireAuth(request).user.id, request.params.projectId)
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', download(file.fileName))
        .header('Cache-Control', 'private, no-store')
        .send(file.content)
    },
  )

  app.post(
    '/import/tasks',
    {
      config,
      schema: {
        tags,
        summary: 'Create tasks from a file',
        description:
          'Send the file as the body. `csv`: our export, a Jira CSV export or any sheet with ' +
          'a Title (or Summary) column; `trello`: a Trello board exported as JSON. Labels, ' +
          'milestones and columns the project lacks are added; nobody is notified. Owners only.',
        params: projectParams,
        querystring: importQuerySchema,
        response: { 200: importResultSchema, ...errors, 413: errorResponseSchema },
      },
    },
    async (request) => {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        throw invalid('The file is empty')
      }
      const { projectId } = request.params
      const result = await importTasks(
        db,
        requireAuth(request).user.id,
        projectId,
        request.query.format,
        request.body,
      )
      // Everything an import may have added, so open boards show it at once.
      for (const resource of ['tasks', 'statuses', 'labels', 'milestones'] as const) {
        void app.events.publishProject(projectId, resource)
      }
      return result
    },
  )
}
