import {
  searchResultsSchema,
  taskInContextSchema,
  type SearchResults,
  type TaskInContext,
} from '@chillawiki/shared'
import { z } from 'zod'
import { apiRequest } from './client'

const taskList = z.array(taskInContextSchema)

export const fetchMyTasks = (includeDone: boolean): Promise<TaskInContext[]> =>
  apiRequest(`/me/tasks${includeDone ? '?includeDone=true' : ''}`, { schema: taskList })

export const searchEverything = (q: string): Promise<SearchResults> =>
  apiRequest(`/search?${new URLSearchParams({ q })}`, { schema: searchResultsSchema })
