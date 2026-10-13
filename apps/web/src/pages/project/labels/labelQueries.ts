import type { CreateLabelRequest, UpdateLabelRequest } from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLabel, deleteLabel, fetchLabels, updateLabel } from '../../../api/labels'

export const labelsKey = (projectId: string) => ['projects', projectId, 'labels'] as const

export const useLabels = (projectId: string) =>
  useQuery({ queryKey: labelsKey(projectId), queryFn: () => fetchLabels(projectId) })

/**
 * Create, change and delete labels. Tasks carry copies of their labels, so renaming,
 * recolouring or deleting one refreshes the task queries too.
 */
export function useLabelMutations(projectId: string) {
  const queryClient = useQueryClient()
  const refreshLabels = () => queryClient.invalidateQueries({ queryKey: labelsKey(projectId) })
  const refreshLabelsAndTasks = () =>
    Promise.all([
      refreshLabels(),
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] }),
    ])

  return {
    create: useMutation({
      mutationFn: (input: CreateLabelRequest) => createLabel(projectId, input),
      onSuccess: refreshLabels,
    }),
    update: useMutation({
      mutationFn: ({ labelId, patch }: { labelId: string; patch: UpdateLabelRequest }) =>
        updateLabel(projectId, labelId, patch),
      onSuccess: refreshLabelsAndTasks,
    }),
    remove: useMutation({
      mutationFn: (labelId: string) => deleteLabel(projectId, labelId),
      onSuccess: refreshLabelsAndTasks,
    }),
  }
}
