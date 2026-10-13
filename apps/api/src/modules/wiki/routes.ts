import {
  createWikiPageRequestSchema,
  errorResponseSchema,
  updateWikiPageRequestSchema,
  wikiListQuerySchema,
  wikiPageSchema,
  wikiPageSummarySchema,
  wikiVersionSchema,
  wikiVersionSummarySchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import {
  createPage,
  deletePage,
  getPage,
  getVersion,
  listPages,
  listVersions,
  updatePage,
} from './service'

const projectParams = z.object({ projectId: z.uuid() })
const pageParams = projectParams.extend({ pageId: z.uuid() })
const versionParams = pageParams.extend({ version: z.coerce.number().int().min(1).max(2147483647) })

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

/** Wiki pages; mounted under `/api/projects/:projectId/wiki`. */
export const wikiRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', async (request) => {
    requireAuth(request)
  })

  const tags = ['wiki']

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'All wiki pages of a project, without content',
        description:
          'Sorted by title. Build the page tree from `parentId`; pass `q` to search titles and content.',
        params: projectParams,
        querystring: wikiListQuerySchema,
        response: { 200: z.array(wikiPageSummarySchema), ...errors },
      },
    },
    (request) =>
      listPages(db, requireAuth(request).user.id, request.params.projectId, request.query),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Create a wiki page',
        params: projectParams,
        body: createWikiPageRequestSchema,
        response: { 201: wikiPageSchema, ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const page = await createPage(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.body,
      )
      return reply.code(201).send(page)
    },
  )

  app.get(
    '/:pageId',
    {
      schema: {
        tags,
        summary: 'A wiki page with its Markdown content',
        params: pageParams,
        response: { 200: wikiPageSchema, ...errors },
      },
    },
    (request) =>
      getPage(db, requireAuth(request).user.id, request.params.projectId, request.params.pageId),
  )

  app.patch(
    '/:pageId',
    {
      schema: {
        tags,
        summary: 'Edit, rename or move a wiki page',
        description:
          'Send the `version` you loaded as `baseVersion`. A 409 means the page changed in the meantime.',
        params: pageParams,
        body: updateWikiPageRequestSchema,
        response: { 200: wikiPageSchema, ...errors, 409: errorResponseSchema },
      },
    },
    (request) =>
      updatePage(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.pageId,
        request.body,
      ),
  )

  app.delete(
    '/:pageId',
    {
      schema: {
        tags,
        summary: 'Delete a wiki page; its subpages move up one level',
        params: pageParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await deletePage(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.pageId,
      )
      return reply.code(204).send(null)
    },
  )

  app.get(
    '/:pageId/versions',
    {
      schema: {
        tags,
        summary: 'Saved versions of a page, newest first',
        params: pageParams,
        response: { 200: z.array(wikiVersionSummarySchema), ...errors },
      },
    },
    (request) =>
      listVersions(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.pageId,
      ),
  )

  app.get(
    '/:pageId/versions/:version',
    {
      schema: {
        tags,
        summary: 'The title and content of one saved version',
        params: versionParams,
        response: { 200: wikiVersionSchema, ...errors },
      },
    },
    (request) =>
      getVersion(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.pageId,
        request.params.version,
      ),
  )
}
