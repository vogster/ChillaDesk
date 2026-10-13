import {
  milestoneSchema,
  type CreateMilestoneRequest,
  type Milestone,
  type UpdateMilestoneRequest,
} from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiRequest } from '../../../api/client'

const base = (projectId: string) => `/projects/${projectId}/milestones`

const fetchMilestones = (projectId: string): Promise<Milestone[]> =>
  apiRequest(base(projectId), { schema: z.array(milestoneSchema) })

const createMilestone = (projectId: string, input: CreateMilestoneRequest): Promise<Milestone> =>
  apiRequest(base(projectId), { method: 'POST', body: input, schema: milestoneSchema })

const updateMilestone = (
  projectId: string,
  milestoneId: string,
  patch: UpdateMilestoneRequest,
): Promise<Milestone> =>
  apiRequest(`${base(projectId)}/${milestoneId}`, {
    method: 'PATCH',
    body: patch,
    schema: milestoneSchema,
  })

const deleteMilestone = (projectId: string, milestoneId: string): Promise<void> =>
  apiRequest(`${base(projectId)}/${milestoneId}`, { method: 'DELETE' })

export const milestonesKey = (projectId: string) => ['projects', projectId, 'milestones'] as const

export const useMilestones = (projectId: string) =>
  useQuery({ queryKey: milestonesKey(projectId), queryFn: () => fetchMilestones(projectId) })

export function useMilestoneMutations(projectId: string) {
  const queryClient = useQueryClient()
  // Tasks carry the name of their milestone, so a rename or a removal reaches them too.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: milestonesKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] }),
    ])
  return {
    create: useMutation({
      mutationFn: (input: CreateMilestoneRequest) => createMilestone(projectId, input),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: UpdateMilestoneRequest & { id: string }) =>
        updateMilestone(projectId, id, patch),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (milestoneId: string) => deleteMilestone(projectId, milestoneId),
      onSuccess: refresh,
    }),
  }
}
