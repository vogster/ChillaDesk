/** Texts of this part of the app; see ../index.tsx for how they are used. */
export const project = {
  /** Confirms deleting a project or a wiki page. */
  confirmDelete: 'Yes, delete',
  members: {
    heading: 'Members',
    you: '(you)',
    roleOf: (name: string) => `Role of ${name}`,
    leaveProject: 'Leave project',
    removeMember: (name: string) => `Remove ${name}`,
    leave: 'Leave',
    remove: 'Remove',
    addByEmail: 'Add a member by email',
    emailPlaceholder: 'teammate@example.com',
    accountHint: 'They need a ChillaDesk account first',
    role: 'Role',
  },
  settings: {
    heading: 'Settings',
    name: 'Name',
    description: 'Description',
    saveChanges: 'Save changes',
    saved: 'Saved',
    /** The project's name stands in bold between the two parts. */
    deleteConfirm: { before: 'Delete ', after: ' with all its data? This cannot be undone.' },
    deleteProject: 'Delete project…',
  },
  columns: {
    heading: 'Board columns',
    hint: 'The kind tells ChillaDesk which columns hold finished work, whatever they are called.',
    /** The kind of a column, by status category. */
    category: {
      todo: 'Not started',
      in_progress: 'In progress',
      done: 'Done',
    },
    nameOf: (position: number) => `Name of column ${position}`,
    kindOf: (name: string) => `Kind of ${name}`,
    moveLeft: (name: string) => `Move ${name} left`,
    moveRight: (name: string) => `Move ${name} right`,
    deleteColumn: (name: string) => `Delete ${name}`,
    newColumn: 'New column',
    kind: 'Kind',
    add: 'Add column',
  },
  milestones: {
    heading: 'Milestones',
    empty:
      'No milestones yet. A milestone is a point the project works towards: a release, a deadline.',
    newMilestone: 'New milestone',
    name: 'Name',
    date: 'Date',
    add: 'Add milestone',
    closed: 'closed',
    noDate: 'no date',
    due: (date: string) => `due ${date}`,
    overdue: (date: string) => `was due ${date}`,
    noTasks: 'No tasks on this milestone yet.',
    progress: (done: number, total: number, percent: number) =>
      `${done} of ${total} tasks done (${percent}%)`,
    progressOf: (name: string) => `Progress of ${name}`,
    close: 'Close',
    reopen: 'Reopen',
    closeLabel: (name: string) => `Close the milestone ${name}`,
    reopenLabel: (name: string) => `Reopen the milestone ${name}`,
    deleteLabel: (name: string) => `Delete the milestone ${name}`,
    deleteConfirm: 'Delete this milestone? Its tasks stay, without a milestone.',
  },
  wiki: {
    search: 'Search the wiki',
    newPageLink: '+ New page',
    pagesNav: 'Wiki pages',
    noMatches: 'No pages match your search.',
    noPages: 'No pages yet.',
    empty: {
      title: 'This wiki is empty',
      hint: 'Keep notes, decisions and how-tos next to the tasks they belong to.',
      action: 'Write the first page',
    },
    page: {
      /** `author` is missing when the user who saved the page was deleted. */
      savedInfo: (version: number, date: string, author: string | undefined) =>
        `Version ${version}, saved ${date}${author ? ` by ${author}` : ''}`,
      noContent: 'This page has no content yet.',
      /** The page's title stands in bold between the two parts. */
      deleteConfirm: {
        before: 'Delete ',
        after: ' and its history? Its subpages are kept and move up one level.',
      },
      deletePage: 'Delete page…',
    },
    editor: {
      newPage: 'New page',
      editPage: 'Edit page',
      draftRestored: 'Your unsaved changes from earlier were restored.',
      discardDraft: 'Discard them',
      title: 'Title',
      parent: 'Parent page',
      noParent: 'None (top level)',
      mode: 'Editor mode',
      write: 'Write',
      preview: 'Preview',
      nothingToPreview: 'Nothing to preview yet.',
      content: 'Content',
      contentPlaceholder: (projectKey: string) =>
        `Markdown. Link pages with [[Page title]] and tasks with ${projectKey}-1.`,
      saving: 'Saving…',
      createPage: 'Create page',
      /** Shown after "someone else saved first"; `action` is a button inside the sentence. */
      conflict: {
        before: 'Your text is still here. Copy what you need, or ',
        action: 'save your version over theirs',
        after: '.',
      },
    },
    history: {
      heading: 'History',
      version: (version: number) => `Version ${version}`,
      current: 'current',
      noVersion: (version: number) => `This page has no version ${version}.`,
      restore: 'Restore this version',
      noContent: 'This version had no content.',
    },
  },
}

export type ProjectMessages = typeof project
