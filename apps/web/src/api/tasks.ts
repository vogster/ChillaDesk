import {
  commentSchema,
  statusSchema,
  taskListSchema,
  taskSchema,
  type Comment,
  type CreateStatusRequest,
  type MoveTaskRequest,
  type Status,
  type Task,
  type TaskList,
  type TaskPriority,
  type UpdateStatusRequest,
  type UpdateTaskRequest,
} from '@chillawiki/shared'
import { z } from 'zod'
import { apiRequest } from './client'

const statusList = z.array(statusSchema)
const commentList = z.array(commentSchema)

export interface TaskFilters {
  statusId?: string
  /** A user id, or `none` for unassigned tasks. */
  assigneeId?: string
  priority?: TaskPriority
  labelId?: string
  q?: string
}

/** What the create form sends; the server fills in the rest. */
export interface NewTask {
  title: string
  statusId?: string
}

const base = (projectId: string) => `/projects/${projectId}`

function queryString(filters: TaskFilters): string {
  const params = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
  const text = params.toString()
  return text ? `?${text}` : ''
}

export const fetchStatuses = (projectId: string): Promise<Status[]> =>
  apiRequest(`${base(projectId)}/statuses`, { schema: statusList })

export const createStatus = (projectId: string, input: CreateStatusRequest): Promise<Status> =>
  apiRequest(`${base(projectId)}/statuses`, { method: 'POST', body: input, schema: statusSchema })

export const updateStatus = (
  projectId: string,
  statusId: string,
  patch: UpdateStatusRequest,
): Promise<Status> =>
  apiRequest(`${base(projectId)}/statuses/${statusId}`, {
    method: 'PATCH',
    body: patch,
    schema: statusSchema,
  })

export const reorderStatuses = (projectId: string, statusIds: string[]): Promise<Status[]> =>
  apiRequest(`${base(projectId)}/statuses/order`, {
    method: 'PUT',
    body: { statusIds },
    schema: statusList,
  })

export const deleteStatus = (projectId: string, statusId: string): Promise<void> =>
  apiRequest(`${base(projectId)}/statuses/${statusId}`, { method: 'DELETE' })

export const fetchTasks = (projectId: string, filters: TaskFilters = {}): Promise<TaskList> =>
  apiRequest(`${base(projectId)}/tasks${queryString(filters)}`, { schema: taskListSchema })

export const fetchTask = (projectId: string, taskId: string): Promise<Task> =>
  apiRequest(`${base(projectId)}/tasks/${taskId}`, { schema: taskSchema })

export const createTask = (projectId: string, input: NewTask): Promise<Task> =>
  apiRequest(`${base(projectId)}/tasks`, { method: 'POST', body: input, schema: taskSchema })

export const updateTask = (
  projectId: string,
  taskId: string,
  patch: UpdateTaskRequest,
): Promise<Task> =>
  apiRequest(`${base(projectId)}/tasks/${taskId}`, {
    method: 'PATCH',
    body: patch,
    schema: taskSchema,
  })

export const moveTask = (
  projectId: string,
  taskId: string,
  target: MoveTaskRequest,
): Promise<Task> =>
  apiRequest(`${base(projectId)}/tasks/${taskId}/move`, {
    method: 'POST',
    body: target,
    schema: taskSchema,
  })

export const deleteTask = (projectId: string, taskId: string): Promise<void> =>
  apiRequest(`${base(projectId)}/tasks/${taskId}`, { method: 'DELETE' })

export const fetchComments = (projectId: string, taskId: string): Promise<Comment[]> =>
  apiRequest(`${base(projectId)}/tasks/${taskId}/comments`, { schema: commentList })

export const addComment = (projectId: string, taskId: string, body: string): Promise<Comment> =>
  apiRequest(`${base(projectId)}/tasks/${taskId}/comments`, {
    method: 'POST',
    body: { body },
    schema: commentSchema,
  })

export const updateComment = (
  projectId: string,
  taskId: string,
  commentId: string,
  body: string,
): Promise<Comment> =>
  apiRequest(`${base(projectId)}/tasks/${taskId}/comments/${commentId}`, {
    method: 'PATCH',
    body: { body },
    schema: commentSchema,
  })

export const deleteComment = (
  projectId: string,
  taskId: string,
  commentId: string,
): Promise<void> =>
  apiRequest(`${base(projectId)}/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' })
