import {
  wikiPageSchema,
  wikiPageSummarySchema,
  wikiVersionSchema,
  wikiVersionSummarySchema,
  type CreateWikiPageRequest,
  type UpdateWikiPageRequest,
  type WikiPage,
  type WikiPageSummary,
  type WikiVersion,
  type WikiVersionSummary,
} from '@chilladesk/shared'
import { z } from 'zod'
import { apiRequest } from './client'

const pageList = z.array(wikiPageSummarySchema)
const versionList = z.array(wikiVersionSummarySchema)

const base = (projectId: string) => `/projects/${projectId}/wiki`

export const fetchWikiPages = (projectId: string, q?: string): Promise<WikiPageSummary[]> =>
  apiRequest(`${base(projectId)}${q ? `?${new URLSearchParams({ q })}` : ''}`, {
    schema: pageList,
  })

export const fetchWikiPage = (projectId: string, pageId: string): Promise<WikiPage> =>
  apiRequest(`${base(projectId)}/${pageId}`, { schema: wikiPageSchema })

/** What the editor sends; the server fills in defaults for the rest. */
export type NewWikiPage = Pick<CreateWikiPageRequest, 'title' | 'content' | 'parentId'>

export const createWikiPage = (projectId: string, input: NewWikiPage): Promise<WikiPage> =>
  apiRequest(base(projectId), { method: 'POST', body: input, schema: wikiPageSchema })

export const updateWikiPage = (
  projectId: string,
  pageId: string,
  patch: UpdateWikiPageRequest,
): Promise<WikiPage> =>
  apiRequest(`${base(projectId)}/${pageId}`, {
    method: 'PATCH',
    body: patch,
    schema: wikiPageSchema,
  })

export const deleteWikiPage = (projectId: string, pageId: string): Promise<void> =>
  apiRequest(`${base(projectId)}/${pageId}`, { method: 'DELETE' })

export const fetchWikiVersions = (
  projectId: string,
  pageId: string,
): Promise<WikiVersionSummary[]> =>
  apiRequest(`${base(projectId)}/${pageId}/versions`, { schema: versionList })

export const fetchWikiVersion = (
  projectId: string,
  pageId: string,
  version: number,
): Promise<WikiVersion> =>
  apiRequest(`${base(projectId)}/${pageId}/versions/${version}`, { schema: wikiVersionSchema })
