import {
  apiTokenSchema,
  createdApiTokenSchema,
  type ApiToken,
  type CreateApiTokenRequest,
  type CreatedApiToken,
} from '@chilladesk/shared'
import { z } from 'zod'
import { apiRequest } from './client'

const tokenList = z.array(apiTokenSchema)

export const fetchApiTokens = (): Promise<ApiToken[]> =>
  apiRequest('/tokens', { schema: tokenList })

export const createApiToken = (input: CreateApiTokenRequest): Promise<CreatedApiToken> =>
  apiRequest('/tokens', { method: 'POST', body: input, schema: createdApiTokenSchema })

export const revokeApiToken = (tokenId: string): Promise<void> =>
  apiRequest(`/tokens/${tokenId}`, { method: 'DELETE' })
