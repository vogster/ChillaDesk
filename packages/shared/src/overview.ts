import { z } from 'zod'
import { textSchema } from './auth'
import { projectKeySchema } from './projects'
import { statusSchema, taskSchema } from './tasks'

/** Enough of a project to show where something lives and link to it. */
export const projectRefSchema = z.object({
  id: z.uuid(),
  key: projectKeySchema,
  name: z.string(),
})
export type ProjectRef = z.infer<typeof projectRefSchema>

/** A task outside the context of one project page: with its project and its status. */
export const taskInContextSchema = taskSchema.extend({
  project: projectRefSchema,
  status: statusSchema,
})
export type TaskInContext = z.infer<typeof taskInContextSchema>

export const myTasksQuerySchema = z.object({
  /** Also return tasks that sit in a "done" column. */
  includeDone: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})
export type MyTasksQuery = z.infer<typeof myTasksQuerySchema>

export const SEARCH_RESULTS_MAX = 20

export const searchQuerySchema = z.object({
  /** Text to find in task titles and descriptions and in wiki titles and content. */
  q: textSchema.trim().min(2).max(200),
})
export type SearchQuery = z.infer<typeof searchQuerySchema>

export const wikiSearchHitSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  project: projectRefSchema,
  updatedAt: z.iso.datetime(),
})
export type WikiSearchHit = z.infer<typeof wikiSearchHitSchema>

/** At most `SEARCH_RESULTS_MAX` of each kind, best matches first. */
export const searchResultsSchema = z.object({
  tasks: z.array(taskInContextSchema),
  pages: z.array(wikiSearchHitSchema),
})
export type SearchResults = z.infer<typeof searchResultsSchema>
