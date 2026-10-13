import type {
  CreateStatusRequest,
  MoveTaskRequest,
  Task,
  TaskList,
  UpdateStatusRequest,
  UpdateTaskRequest,
} from '@chilladesk/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addComment,
  createStatus,
  createTask,
  deleteComment,
  deleteStatus,
  deleteTask,
  fetchComments,
  fetchStatuses,
  fetchTask,
  fetchTasks,
  moveTask,
  reorderStatuses,
  updateComment,
  updateStatus,
  updateTask,
  type NewTask,
  type TaskFilters,
} from '../../api/tasks'
import { applyMove } from './board/moves'

export const taskKeys = {
  statuses: (projectId: string) => ['projects', projectId, 'statuses'] as const,
  /** Prefix of every task query of the project: lists, single tasks and comments. */
  all: (projectId: string) => ['projects', projectId, 'tasks'] as const,
  list: (projectId: string, filters: TaskFilters = {}) =>
    ['projects', projectId, 'tasks', 'list', filters] as const,
  detail: (projectId: string, taskId: string) =>
    ['projects', projectId, 'tasks', 'detail', taskId] as const,
  comments: (projectId: string, taskId: string) =>
    ['projects', projectId, 'tasks', 'detail', taskId, 'comments'] as const,
}

export const useStatuses = (projectId: string) =>
  useQuery({ queryKey: taskKeys.statuses(projectId), queryFn: () => fetchStatuses(projectId) })

export const useTasks = (projectId: string, filters: TaskFilters = {}) =>
  useQuery({
    queryKey: taskKeys.list(projectId, filters),
    queryFn: () => fetchTasks(projectId, filters),
    // Keep showing the previous result while a changed filter loads, instead of a spinner.
    placeholderData: keepPreviousData,
  })

export const useTask = (projectId: string, taskId: string) =>
  useQuery({
    queryKey: taskKeys.detail(projectId, taskId),
    queryFn: () => fetchTask(projectId, taskId),
    retry: false,
  })

export const useComments = (projectId: string, taskId: string) =>
  useQuery({
    queryKey: taskKeys.comments(projectId, taskId),
    queryFn: () => fetchComments(projectId, taskId),
  })

/** Every task change can affect lists, the open task and its neighbours, so all are refreshed. */
function useRefreshTasks(projectId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: taskKeys.all(projectId) })
}

export function useCreateTask(projectId: string) {
  const refresh = useRefreshTasks(projectId)
  return useMutation({
    mutationFn: (input: NewTask) => createTask(projectId, input),
    onSuccess: refresh,
  })
}

export function useUpdateTask(projectId: string, taskId: string) {
  const queryClient = useQueryClient()
  const refresh = useRefreshTasks(projectId)
  return useMutation({
    mutationFn: (patch: UpdateTaskRequest) => updateTask(projectId, taskId, patch),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(projectId, taskId), task)
      return refresh()
    },
  })
}

interface MoveVariables {
  taskId: string
  target: MoveTaskRequest
  /** The board as it was before the move, to go back to if the server refuses it. */
  previous: TaskList | undefined
}

/** Moves a task, updating the unfiltered list (the board) immediately and rolling back on failure. */
export function useMoveTask(projectId: string) {
  const queryClient = useQueryClient()
  const refresh = useRefreshTasks(projectId)
  const boardKey = taskKeys.list(projectId)
  const mutationKey = ['projects', projectId, 'move-task'] as const
  // True while this is the only move in flight; the count includes the move asking.
  const isLastMove = () => queryClient.isMutating({ mutationKey }) === 1

  const mutation = useMutation({
    mutationKey,
    mutationFn: ({ taskId, target }: MoveVariables) => moveTask(projectId, taskId, target),
    onError: (_error, { previous }) => {
      // With other moves still pending the snapshot is out of date and would undo them;
      // the refetch after the last one settles puts everything right instead.
      if (previous && isLastMove()) queryClient.setQueryData(boardKey, previous)
    },
    onSuccess: (task) => queryClient.setQueryData(taskKeys.detail(projectId, task.id), task),
    // Refetching between two moves could show the server's state from before the second.
    onSettled: () => (isLastMove() ? refresh() : undefined),
  })

  /**
   * Starts the move. The cache is updated here, in the caller's own event handler, rather
   * than in `onMutate`: that runs a moment later, and a dropped card would be drawn in its
   * old place for a frame first.
   */
  const move = (taskId: string, target: MoveTaskRequest) => {
    // A fetch already under way would overwrite the update with the old order.
    void queryClient.cancelQueries({ queryKey: boardKey })
    const previous = queryClient.getQueryData<TaskList>(boardKey)
    if (previous) {
      queryClient.setQueryData<TaskList>(boardKey, {
        ...previous,
        items: applyMove(previous.items, taskId, target),
      })
    }
    // The open task dialog shows the new column at once as well.
    queryClient.setQueryData<Task>(taskKeys.detail(projectId, taskId), (task) =>
      task ? { ...task, statusId: target.statusId } : task,
    )
    mutation.mutate({ taskId, target, previous })
  }

  return { ...mutation, move }
}

export function useDeleteTask(projectId: string, taskId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => deleteTask(projectId, taskId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: taskKeys.detail(projectId, taskId) })
      return queryClient.invalidateQueries({ queryKey: taskKeys.all(projectId) })
    },
  })
}

export function useCommentMutations(projectId: string, taskId: string) {
  const queryClient = useQueryClient()
  const onSuccess = () =>
    queryClient.invalidateQueries({ queryKey: taskKeys.comments(projectId, taskId) })
  return {
    add: useMutation({
      mutationFn: (body: string) => addComment(projectId, taskId, body),
      onSuccess,
    }),
    edit: useMutation({
      mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
        updateComment(projectId, taskId, commentId, body),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (commentId: string) => deleteComment(projectId, taskId, commentId),
      onSuccess,
    }),
  }
}

export function useStatusMutations(projectId: string) {
  const queryClient = useQueryClient()
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: taskKeys.statuses(projectId) })
  return {
    create: useMutation({
      mutationFn: (input: CreateStatusRequest) => createStatus(projectId, input),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ statusId, patch }: { statusId: string; patch: UpdateStatusRequest }) =>
        updateStatus(projectId, statusId, patch),
      onSuccess,
    }),
    reorder: useMutation({
      mutationFn: (statusIds: string[]) => reorderStatuses(projectId, statusIds),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (statusId: string) => deleteStatus(projectId, statusId),
      onSuccess,
    }),
  }
}
