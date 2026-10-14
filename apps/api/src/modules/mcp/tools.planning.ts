import {
  createChecklistItemSchema,
  createLabelRequestSchema,
  createMilestoneRequestSchema,
  labelColorSchema,
  taskRelationSchema,
  updateMilestoneRequestSchema,
} from '@chilladesk/shared'
import { z } from 'zod'
import { invalid } from '../../errors'
import { createLabel } from '../labels/service'
import { createMilestone, listMilestones, updateMilestone } from '../milestones/service'
import { addChecklistItem, listChecklist, updateChecklistItem } from '../tasks/checklist.service'
import { addLink } from '../tasks/links.service'
import { setWatching } from '../tasks/watchers.service'
import { milestoneByName, projectByKey, taskByKey } from './resolve'
import { project, taskKey, tool, validate, type ToolDefinition } from './toolkit'

const milestoneDate = z.string().nullable().optional().describe('YYYY-MM-DD, or null for no date.')

/** Tools for planning: milestones, labels, checklists, links between tasks, watching. */
export const PLANNING_TOOLS: ToolDefinition[] = [
  tool({
    name: 'list_milestones',
    title: 'List milestones',
    description:
      'Milestones of a project with their dates and progress (finished tasks of all tasks on it). ' +
      'Open ones first, nearest date on top.',
    readOnly: true,
    inputSchema: { project },
    run: async (input, { db, auth }) => {
      const found = await projectByKey(db, auth.user.id, input.project)
      const milestones = await listMilestones(db, auth.user.id, found.id)
      return milestones.map(({ name, dueDate, closed, progress }) => ({
        name,
        dueDate,
        closed,
        tasksDone: progress.done,
        tasksTotal: progress.total,
      }))
    },
  }),

  tool({
    name: 'create_milestone',
    title: 'Create milestone',
    description: 'Creates a milestone: a release or deadline tasks can be put on.',
    readOnly: false,
    inputSchema: {
      project,
      name: z.string().min(1).max(80),
      dueDate: milestoneDate,
    },
    run: async (input, { db, auth, changed }) => {
      const found = await projectByKey(db, auth.user.id, input.project)
      const request = validate(createMilestoneRequestSchema, {
        name: input.name,
        dueDate: input.dueDate ?? null,
      })
      const created = await createMilestone(db, auth.user.id, found.id, request)
      changed?.(found.id, 'milestones')
      return { name: created.name, dueDate: created.dueDate, closed: created.closed }
    },
  }),

  tool({
    name: 'update_milestone',
    title: 'Update milestone',
    description: 'Renames a milestone, changes its date, or closes or reopens it.',
    readOnly: false,
    inputSchema: {
      project,
      milestone: z.string().describe('Current name of the milestone.'),
      newName: z.string().min(1).max(80).optional(),
      dueDate: milestoneDate,
      closed: z.boolean().optional(),
    },
    run: async (input, { db, auth, changed }) => {
      const userId = auth.user.id
      const found = await projectByKey(db, userId, input.project)
      const milestone = await milestoneByName(db, userId, found.id, input.milestone)
      const request = validate(updateMilestoneRequestSchema, {
        ...(input.newName !== undefined ? { name: input.newName } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.closed !== undefined ? { closed: input.closed } : {}),
      })
      const updated = await updateMilestone(db, userId, found.id, milestone.id, request)
      changed?.(found.id, 'milestones')
      return { name: updated.name, dueDate: updated.dueDate, closed: updated.closed }
    },
  }),

  tool({
    name: 'create_label',
    title: 'Create label',
    description: 'Creates a label that tasks of the project can carry.',
    readOnly: false,
    inputSchema: {
      project,
      name: z.string().min(1).max(40),
      color: labelColorSchema.optional(),
    },
    run: async (input, { db, auth, changed }) => {
      const found = await projectByKey(db, auth.user.id, input.project)
      const request = validate(createLabelRequestSchema, { name: input.name, color: input.color })
      const created = await createLabel(db, auth.user.id, found.id, request)
      changed?.(found.id, 'labels')
      return { name: created.name, color: created.color }
    },
  }),

  tool({
    name: 'add_checklist_item',
    title: 'Add checklist item',
    description: 'Adds an item to the end of the checklist of a task.',
    readOnly: false,
    inputSchema: { key: taskKey, text: z.string().min(1).max(300) },
    run: async (input, { db, auth, changed }) => {
      const userId = auth.user.id
      const { project: found, task } = await taskByKey(db, userId, input.key)
      const request = validate(createChecklistItemSchema, { text: input.text })
      await addChecklistItem(db, userId, found.id, task.id, request)
      changed?.(found.id, 'tasks')
      return checklistOf(await listChecklist(db, userId, found.id, task.id))
    },
  }),

  tool({
    name: 'check_checklist_item',
    title: 'Tick or untick checklist item',
    description:
      'Marks a checklist item of a task as done or not done. Name the item by its number in ' +
      'the list (1 is the first) or by its text.',
    readOnly: false,
    inputSchema: {
      key: taskKey,
      item: z.union([z.number().int().min(1), z.string().min(1)]),
      done: z.boolean(),
    },
    run: async (input, { db, auth, changed }) => {
      const userId = auth.user.id
      const { project: found, task } = await taskByKey(db, userId, input.key)
      const items = await listChecklist(db, userId, found.id, task.id)
      const target =
        typeof input.item === 'number'
          ? items[input.item - 1]
          : items.find(
              (item) => item.text.toLowerCase() === String(input.item).trim().toLowerCase(),
            )
      if (!target) {
        throw invalid(
          `No item ${JSON.stringify(input.item)} in the checklist of ${task.key}, which has ${items.length}`,
        )
      }
      await updateChecklistItem(db, userId, found.id, task.id, target.id, { done: input.done })
      changed?.(found.id, 'tasks')
      return checklistOf(await listChecklist(db, userId, found.id, task.id))
    },
  }),

  tool({
    name: 'link_tasks',
    title: 'Link tasks',
    description:
      'Links two tasks of the same project. The relation is read from the first task: ' +
      '"CHL-3 blocked_by CHL-1" means CHL-1 blocks CHL-3.',
    readOnly: false,
    inputSchema: {
      key: taskKey,
      relation: taskRelationSchema,
      otherKey: taskKey,
    },
    run: async (input, { db, auth, changed }) => {
      const userId = auth.user.id
      const { project: found, task } = await taskByKey(db, userId, input.key)
      const { project: otherProject, task: other } = await taskByKey(db, userId, input.otherKey)
      if (otherProject.id !== found.id)
        throw invalid('Only tasks of the same project can be linked')
      const links = await addLink(db, userId, found.id, task.id, {
        relation: input.relation,
        taskNumber: other.number,
      })
      changed?.(found.id, 'tasks')
      return links.map((link) => ({
        relation: link.relation,
        task: link.task.key,
        done: link.task.done,
      }))
    },
  }),

  tool({
    name: 'watch_task',
    title: 'Watch or unwatch task',
    description:
      'Starts or stops watching a task for the token owner. Watchers are notified about new ' +
      'comments and about moves to another column.',
    readOnly: false,
    inputSchema: { key: taskKey, watching: z.boolean() },
    run: async (input, { db, auth }) => {
      const userId = auth.user.id
      const { project: found, task } = await taskByKey(db, userId, input.key)
      const result = await setWatching(db, userId, found.id, task.id, input.watching)
      return { watching: result.watching, watchers: result.watchers.map((user) => user.email) }
    },
  }),
]

function checklistOf(items: { text: string; done: boolean }[]) {
  return items.map((item, index) => ({ number: index + 1, text: item.text, done: item.done }))
}
