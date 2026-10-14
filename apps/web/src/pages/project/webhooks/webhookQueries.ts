import {
  createdWebhookSchema,
  webhookDeliverySchema,
  webhookSchema,
  type CreatedWebhook,
  type CreateWebhookRequest,
  type UpdateWebhookRequest,
  type Webhook,
  type WebhookDelivery,
} from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiRequest } from '../../../api/client'

const base = (projectId: string) => `/projects/${projectId}/webhooks`

const fetchWebhooks = (projectId: string): Promise<Webhook[]> =>
  apiRequest(base(projectId), { schema: z.array(webhookSchema) })

const createWebhook = (projectId: string, input: CreateWebhookRequest): Promise<CreatedWebhook> =>
  apiRequest(base(projectId), { method: 'POST', body: input, schema: createdWebhookSchema })

const updateWebhook = (
  projectId: string,
  webhookId: string,
  patch: UpdateWebhookRequest,
): Promise<Webhook> =>
  apiRequest(`${base(projectId)}/${webhookId}`, {
    method: 'PATCH',
    body: patch,
    schema: webhookSchema,
  })

const deleteWebhook = (projectId: string, webhookId: string): Promise<void> =>
  apiRequest(`${base(projectId)}/${webhookId}`, { method: 'DELETE' })

const testWebhook = (projectId: string, webhookId: string): Promise<WebhookDelivery> =>
  apiRequest(`${base(projectId)}/${webhookId}/test`, {
    method: 'POST',
    schema: webhookDeliverySchema,
  })

export const webhooksKey = (projectId: string) => ['projects', projectId, 'webhooks'] as const

export const useWebhooks = (projectId: string) =>
  useQuery({
    queryKey: webhooksKey(projectId),
    queryFn: () => fetchWebhooks(projectId),
    // A delivery waiting to go out is shown until it went; this picks up how it went.
    refetchInterval: (query) =>
      query.state.data?.some((webhook) => webhook.lastDelivery?.status === 'pending')
        ? 5_000
        : false,
  })

export function useWebhookMutations(projectId: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: webhooksKey(projectId) })
  return {
    create: useMutation({
      mutationFn: (input: CreateWebhookRequest) => createWebhook(projectId, input),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ webhookId, patch }: { webhookId: string; patch: UpdateWebhookRequest }) =>
        updateWebhook(projectId, webhookId, patch),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (webhookId: string) => deleteWebhook(projectId, webhookId),
      onSuccess: refresh,
    }),
    test: useMutation({
      mutationFn: (webhookId: string) => testWebhook(projectId, webhookId),
      onSuccess: refresh,
    }),
  }
}
