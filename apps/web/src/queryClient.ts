import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query'
import { ApiError } from './api/client'

export const currentUserKey = ['auth', 'me'] as const

export function createQueryClient(defaultOptions: DefaultOptions = {}): QueryClient {
  // Any request rejected as unauthenticated means the session is gone (expired or revoked),
  // so the app drops to the signed-out state instead of showing errors on every page.
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
      queryClient.setQueryData(currentUserKey, null)
    }
  }

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions,
  })
  return queryClient
}
