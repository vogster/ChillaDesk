/** A card or a column of the board, as named in the announcements of a drag. */
export interface DragItem {
  kind: 'task' | 'column'
  /** Key and title of the task, or the name of the column; null when it is not known. */
  name: string | null
}

const dragItem = ({ kind, name }: DragItem): string => {
  if (kind === 'column') return name === null ? 'a column' : `the ${name} column`
  return name ?? 'a task'
}

/** Texts of this part of the app; see ../index.tsx for how they are used. */
export const tasks = {
  /** The project header and its tabs. */
  layout: {
    backToProjects: '← Projects',
    sections: 'Project sections',
    board: 'Board',
    list: 'List',
    wiki: 'Wiki',
    members: 'Members',
    settings: 'Settings',
  },
  board: {
    truncated: (shown: number, total: number) =>
      `Showing the first ${shown} of ${total} tasks. Use the list to find the rest.`,
    /** Only the noun: it follows the number of cards in a column. */
    countNoun: (count: number): string => (count === 1 ? 'task' : 'tasks'),
    addTo: (column: string) => `Add a task to ${column}`,
    addTask: '+ Add task',
    newTitleIn: (column: string) => `Title of the new task in ${column}`,
    newTitlePlaceholder: 'What needs to be done?',
    done: 'Done',
    move: (title: string) => `Move ${title}`,
    /** Read out by screen readers while a card is dragged with the keyboard. */
    drag: {
      roleDescription: 'sortable',
      instructions:
        'To pick up a draggable item, press the space bar. While dragging, use the arrow keys to move the item. Press space again to drop the item in its new position, or press escape to cancel.',
      describe: dragItem,
      pickedUp: (item: DragItem) => `Picked up ${dragItem(item)}.`,
      over: (item: DragItem, target: DragItem) => `${dragItem(item)} is over ${dragItem(target)}.`,
      notOver: (item: DragItem) => `${dragItem(item)} is not over a column.`,
      dropped: (item: DragItem, target: DragItem) =>
        `${dragItem(item)} was dropped on ${dragItem(target)}.`,
      putBack: (item: DragItem) => `${dragItem(item)} was put back.`,
      cancelled: (item: DragItem) => `Moving ${dragItem(item)} was cancelled.`,
    },
  },
  list: {
    search: 'Search',
    searchPlaceholder: 'Title or description',
    status: 'Status',
    anyStatus: 'Any status',
    assignee: 'Assignee',
    anyone: 'Anyone',
    unassigned: 'Unassigned',
    priority: 'Priority',
    anyPriority: 'Any priority',
    label: 'Label',
    anyLabel: 'Any label',
    noMatches: 'No tasks match these filters.',
    empty: 'No tasks yet. Add one on the board.',
    count: (total: number) => `${total} ${total === 1 ? 'task' : 'tasks'}`,
    showing: (shown: number, total: number) => `Showing ${shown} of ${total} tasks`,
    columns: {
      key: 'Key',
      title: 'Title',
      status: 'Status',
      priority: 'Priority',
      assignee: 'Assignee',
      due: 'Due',
    },
  },
  dialog: {
    label: 'Task',
    missing: 'This task does not exist any more.',
    title: 'Title',
    description: 'Description',
    descriptionPlaceholder: 'Markdown is supported.',
    noDescription: 'No description.',
    status: 'Status',
    priority: 'Priority',
    assignee: 'Assignee',
    unassigned: 'Unassigned',
    dueDate: 'Due date',
    noDueDate: 'None',
    dueDateInvalid: 'Enter a year between 1900 and 2999.',
    /** `author` is null when the account was deleted. */
    created: (author: string | null, date: string) =>
      `Created by ${author ?? 'a deleted user'} on ${date}`,
    deleteConfirm: 'Delete this task and its comments? This cannot be undone.',
    deleteYes: 'Yes, delete',
    deleteTask: 'Delete task…',
  },
  comments: {
    heading: 'Comments',
    empty: 'No comments yet.',
    emptyBody: 'Write a comment first.',
    edited: '(edited)',
    editedAt: (time: string) => `Edited ${time}`,
    editYours: (time: string) => `Edit your comment from ${time}`,
    /** `author` is null when the account was deleted. */
    deleteBy: (author: string | null) => `Delete comment by ${author ?? 'deleted user'}`,
    editLabel: 'Edit comment',
    save: 'Save comment',
    addLabel: 'Add a comment',
    addPlaceholder: 'Add a comment… Markdown is supported, @ mentions a member.',
    submit: 'Comment',
  },
  display: {
    overdue: 'Overdue: ',
    assignedTo: (name: string) => `Assigned to ${name}`,
  },
  labels: {
    listLabel: 'Labels',
    colors: {
      gray: 'Gray',
      red: 'Red',
      orange: 'Orange',
      yellow: 'Yellow',
      green: 'Green',
      teal: 'Teal',
      blue: 'Blue',
      purple: 'Purple',
      pink: 'Pink',
    },
    /** In the dialog of a task. */
    none: 'No labels',
    editLabels: 'Edit labels',
    done: 'Done',
    projectHasNone: 'This project has no labels yet.',
    invalidName: 'Invalid name',
    newLabel: 'New label',
    newColor: 'Colour of the new label',
    create: 'Create label',
    /** In the settings of a project. */
    settings: {
      heading: 'Labels',
      hint: 'Deleting a label takes it off every task that has it.',
      empty: 'No labels yet.',
      nameOf: (label: string) => `Name of label ${label}`,
      colorOf: (label: string) => `Colour of ${label}`,
      deleteLabel: (label: string) => `Delete label ${label}`,
      newLabel: 'New label',
      color: 'Colour',
      add: 'Add label',
    },
  },
  mentions: {
    listLabel: 'Mention a member',
  },
  checklist: {
    heading: 'Checklist',
    progress: (done: number, total: number) => `${done} of ${total} done`,
    /** On a card: how far the checklist is. */
    badge: (done: number, total: number) => `Checklist: ${done} of ${total} done`,
    newItem: 'New checklist item',
    removeItem: (text: string) => `Remove “${text}” from the checklist`,
  },
  links: {
    heading: 'Linked tasks',
    relationLabel: 'Relation',
    taskLabel: 'Task number',
    add: 'Link',
    done: '(done)',
    removeLink: (key: string) => `Remove the link to ${key}`,
    invalidTask: (projectKey: string) =>
      `Enter the number of a task of this project, for example 12 or ${projectKey}-12.`,
    relation: {
      blocks: 'blocks',
      blocked_by: 'is blocked by',
      duplicates: 'duplicates',
      duplicated_by: 'is duplicated by',
      subtask_of: 'is a subtask of',
      parent_of: 'has the subtask',
      relates_to: 'relates to',
    },
  },
  watch: {
    start: 'Watch',
    stop: 'Stop watching',
    count: (count: number) => `${count} watching`,
    hint: 'Watchers are notified about new comments and when the task moves to another column.',
  },
  /** What happened to a task. Worded without a verb for the person, shown underneath. */
  history: {
    heading: 'History',
    created: 'Task created',
    title: (from: string, to: string) => `Title: “${from}” → “${to}”`,
    description: 'Description changed',
    status: (from: string, to: string) => `Column: ${from} → ${to}`,
    priority: (from: string, to: string) => `Priority: ${from} → ${to}`,
    assignee: (from: string | null, to: string | null) =>
      `Assignee: ${from ?? 'nobody'} → ${to ?? 'nobody'}`,
    dueDate: (from: string | null, to: string | null) =>
      `Due date: ${from ?? 'none'} → ${to ?? 'none'}`,
    labels: (added: string[], removed: string[]) =>
      `Labels: ${[
        added.length > 0 ? `added ${added.join(', ')}` : '',
        removed.length > 0 ? `removed ${removed.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ')}`,
  },
}

export type TasksMessages = typeof tasks
