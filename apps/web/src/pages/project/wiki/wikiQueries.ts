import type { UpdateWikiPageRequest, WikiPage } from '@chillawiki/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createWikiPage,
  deleteWikiPage,
  fetchWikiPage,
  fetchWikiPages,
  fetchWikiVersion,
  fetchWikiVersions,
  updateWikiPage,
  type NewWikiPage,
} from '../../../api/wiki'

export const wikiKeys = {
  /** Prefix of every wiki query of the project. */
  all: (projectId: string) => ['projects', projectId, 'wiki'] as const,
  list: (projectId: string, q = '') => ['projects', projectId, 'wiki', 'list', q] as const,
  page: (projectId: string, pageId: string) =>
    ['projects', projectId, 'wiki', 'page', pageId] as const,
  versions: (projectId: string, pageId: string) =>
    ['projects', projectId, 'wiki', 'page', pageId, 'versions'] as const,
  version: (projectId: string, pageId: string, version: number) =>
    ['projects', projectId, 'wiki', 'page', pageId, 'versions', version] as const,
}

/** All pages of the project (no content); with `q`, only the pages that match the search. */
export const useWikiPages = (projectId: string, q = '', { enabled = true } = {}) =>
  useQuery({
    queryKey: wikiKeys.list(projectId, q),
    queryFn: () => fetchWikiPages(projectId, q || undefined),
    placeholderData: keepPreviousData,
    enabled,
  })

export const useWikiPage = (projectId: string, pageId: string) =>
  useQuery({
    queryKey: wikiKeys.page(projectId, pageId),
    queryFn: () => fetchWikiPage(projectId, pageId),
    retry: false,
  })

/**
 * The page as the server has it right now, ignoring the cache: an editor that started from
 * a copy someone has since changed would only find out when saving.
 */
export function useFreshWikiPage(projectId: string, pageId: string) {
  const page = useQuery({
    queryKey: wikiKeys.page(projectId, pageId),
    queryFn: () => fetchWikiPage(projectId, pageId),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  return { ...page, isFresh: page.isFetchedAfterMount && !page.isFetching }
}

export const useWikiVersions = (projectId: string, pageId: string) =>
  useQuery({
    queryKey: wikiKeys.versions(projectId, pageId),
    queryFn: () => fetchWikiVersions(projectId, pageId),
  })

export const useWikiVersion = (projectId: string, pageId: string, version: number | null) =>
  useQuery({
    queryKey: wikiKeys.version(projectId, pageId, version ?? 0),
    queryFn: () => fetchWikiVersion(projectId, pageId, version ?? 0),
    enabled: version !== null,
    // A saved version never changes.
    staleTime: Infinity,
  })

export function useCreateWikiPage(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NewWikiPage) => createWikiPage(projectId, input),
    onSuccess: (page) => {
      queryClient.setQueryData(wikiKeys.page(projectId, page.id), page)
      // Not awaited: the caller moves on to the new page while the lists refresh.
      void queryClient.invalidateQueries({ queryKey: wikiKeys.all(projectId) })
    },
  })
}

function useStoreSavedPage(projectId: string, pageId: string) {
  const queryClient = useQueryClient()
  return (page: WikiPage) => {
    queryClient.setQueryData(wikiKeys.page(projectId, pageId), page)
    void queryClient.invalidateQueries({ queryKey: wikiKeys.all(projectId) })
  }
}

export function useUpdateWikiPage(projectId: string, pageId: string) {
  return useMutation({
    mutationFn: (patch: UpdateWikiPageRequest) => updateWikiPage(projectId, pageId, patch),
    onSuccess: useStoreSavedPage(projectId, pageId),
  })
}

/**
 * Saves on top of whatever is stored now, for an editor who was told the page changed and
 * chose their own text. The text they replace stays in the page history.
 */
export function useOverwriteWikiPage(projectId: string, pageId: string) {
  return useMutation({
    mutationFn: async (text: { title: string; content: string }) => {
      const latest = await fetchWikiPage(projectId, pageId)
      return updateWikiPage(projectId, pageId, { ...text, baseVersion: latest.version })
    },
    onSuccess: useStoreSavedPage(projectId, pageId),
  })
}

export function useDeleteWikiPage(projectId: string, pageId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => deleteWikiPage(projectId, pageId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: wikiKeys.page(projectId, pageId) })
      // Every page list, whatever its search text.
      void queryClient.invalidateQueries({ queryKey: [...wikiKeys.all(projectId), 'list'] })
    },
  })
}
