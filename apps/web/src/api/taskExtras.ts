import {
  checklistItemSchema,
  taskLinkSchema,
  type ChecklistItem,
  type CreateTaskLink,
  type TaskLink,
  type UpdateChecklistItem,
} from '@chilladesk/shared'
import { z } from 'zod'
import { apiRequest } from './client'

const taskUrl = (projectId: string, taskId: string) => `/projects/${projectId}/tasks/${taskId}`
const linkList = z.array(taskLinkSchema)

export const fetchChecklist = (projectId: string, taskId: string): Promise<ChecklistItem[]> =>
  apiRequest(`${taskUrl(projectId, taskId)}/checklist`, { schema: z.array(checklistItemSchema) })

export const addChecklistItem = (
  projectId: string,
  taskId: string,
  text: string,
): Promise<ChecklistItem> =>
  apiRequest(`${taskUrl(projectId, taskId)}/checklist`, {
    method: 'POST',
    body: { text },
    schema: checklistItemSchema,
  })

export const updateChecklistItem = (
  projectId: string,
  taskId: string,
  itemId: string,
  patch: UpdateChecklistItem,
): Promise<ChecklistItem> =>
  apiRequest(`${taskUrl(projectId, taskId)}/checklist/${itemId}`, {
    method: 'PATCH',
    body: patch,
    schema: checklistItemSchema,
  })

export const deleteChecklistItem = (
  projectId: string,
  taskId: string,
  itemId: string,
): Promise<void> =>
  apiRequest(`${taskUrl(projectId, taskId)}/checklist/${itemId}`, { method: 'DELETE' })

export const fetchTaskLinks = (projectId: string, taskId: string): Promise<TaskLink[]> =>
  apiRequest(`${taskUrl(projectId, taskId)}/links`, { schema: linkList })

/** Answers with all links of the task, the new one included. */
export const addTaskLink = (
  projectId: string,
  taskId: string,
  input: CreateTaskLink,
): Promise<TaskLink[]> =>
  apiRequest(`${taskUrl(projectId, taskId)}/links`, {
    method: 'POST',
    body: input,
    schema: linkList,
  })

export const removeTaskLink = (projectId: string, taskId: string, linkId: string): Promise<void> =>
  apiRequest(`${taskUrl(projectId, taskId)}/links/${linkId}`, { method: 'DELETE' })
