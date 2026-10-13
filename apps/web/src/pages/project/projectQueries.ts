import type { Project, ProjectRole } from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addMember,
  createProject,
  deleteProject,
  fetchMembers,
  fetchProject,
  fetchProjects,
  removeMember,
  updateMemberRole,
  updateProject,
} from '../../api/projects'

export const projectKeys = {
  all: ['projects'] as const,
  detail: (projectId: string) => ['projects', projectId] as const,
  members: (projectId: string) => ['projects', projectId, 'members'] as const,
}

export const useProjects = () => useQuery({ queryKey: projectKeys.all, queryFn: fetchProjects })

export const useProject = (projectId: string) =>
  useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => fetchProject(projectId),
    retry: false,
  })

export const useMembers = (projectId: string, { enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => fetchMembers(projectId),
    enabled,
  })

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  })
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: { name: string; description: string }) => updateProject(projectId, patch),
    onSuccess: (project: Project) => {
      queryClient.setQueryData(projectKeys.detail(projectId), project)
      return queryClient.invalidateQueries({ queryKey: projectKeys.all, exact: true })
    },
  })
}

export function useDeleteProject(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => deleteProject(projectId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(projectId) })
      return queryClient.invalidateQueries({ queryKey: projectKeys.all, exact: true })
    },
  })
}

/**
 * Add, change and remove members. A change can alter the current user's own role or remove
 * them from the project, so the project itself and the project list are refreshed as well.
 */
export function useMemberMutations(projectId: string, currentUserId: string) {
  const queryClient = useQueryClient()
  const refreshMembers = () =>
    queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) })
  // The detail key is a prefix of the members key, so this refreshes both.
  const refreshProject = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
      queryClient.invalidateQueries({ queryKey: projectKeys.all, exact: true }),
    ])

  return {
    add: useMutation({
      mutationFn: (input: { email: string; role: ProjectRole }) => addMember(projectId, input),
      onSuccess: refreshMembers,
    }),
    changeRole: useMutation({
      mutationFn: (input: { userId: string; role: ProjectRole }) =>
        updateMemberRole(projectId, input.userId, input.role),
      onSuccess: refreshProject,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => removeMember(projectId, userId),
      onSuccess: (_result, userId) => {
        if (userId !== currentUserId) {
          // The server unassigned that member's tasks.
          void queryClient.invalidateQueries({
            queryKey: [...projectKeys.detail(projectId), 'tasks'],
          })
          return refreshMembers()
        }
        // The user left: the project is no longer theirs to see.
        queryClient.removeQueries({ queryKey: projectKeys.detail(projectId) })
        return queryClient.invalidateQueries({ queryKey: projectKeys.all, exact: true })
      },
    }),
  }
}
