/** Texts of this part of the app; see ../index.tsx for how they are used. */
export const shell = {
  app: {
    tryAgain: 'Try again',
  },
  nav: {
    /** Accessible name of the main navigation. */
    main: 'Main',
    projects: 'Projects',
    myTasks: 'My tasks',
    tokens: 'API tokens',
    logOut: 'Log out',
    search: 'Search tasks and wiki',
  },
  markdown: {
    missingPage: 'This page does not exist yet. Follow the link to create it.',
  },
  auth: {
    email: 'Email',
    password: 'Password',
    name: 'Name',
    login: {
      title: 'Log in',
      submit: 'Log in',
      submitting: 'Logging in…',
      noAccount: 'No account yet?',
      signUp: 'Sign up',
      invitationOnly:
        'Signing up is by invitation only. Open the invite link you were sent to create an account.',
    },
    register: {
      title: 'Create an account',
      submit: 'Sign up',
      submitting: 'Creating account…',
      haveAccount: 'Already have an account?',
      logIn: 'Log in',
      closed: 'Signing up is turned off on this server.',
      passwordHint: (min: number) => `At least ${min} characters`,
      checkEmail: (email: string) =>
        `Almost there. We sent a link to ${email}: open it to finish signing up. If the address already has an account, the email says so instead.`,
    },
  },
  notFound: {
    title: 'Page not found',
    back: 'Back to your projects',
  },
  projects: {
    title: 'Projects',
    newProject: 'New project',
    name: 'Name',
    key: 'Key',
    keyHint: 'Prefix for task numbers',
    description: 'Description',
    create: 'Create project',
    creating: 'Creating…',
    empty: 'No projects yet',
    emptyHint: 'Create your first project to start tracking tasks and writing docs.',
  },
  tokens: {
    title: 'API tokens',
    intro:
      'A token lets a script or an AI assistant work with your projects as you, through the REST API or MCP. A read-only token can look but not change anything.',
    scope: {
      read: 'Read only',
      write: 'Read and write',
    },
    notice: {
      created: (name: string) => `Token “${name}” created`,
      copyNow: 'Copy it now. For your security it is not stored and cannot be shown again.',
      tokenLabel: 'New API token',
      copyToken: 'Copy token',
      copied: 'Copied',
      mcpTitle: 'Connect an AI assistant (MCP)',
      mcpHint: 'Add this server to your MCP client configuration:',
      configLabel: 'MCP client configuration',
      copyConfig: 'Copy configuration',
      done: 'Done',
    },
    form: {
      title: 'New token',
      name: 'Name',
      namePlaceholder: 'e.g. Claude on my laptop',
      access: 'Access',
      expires: 'Expires',
      expiry: {
        days30: '30 days',
        days90: '90 days',
        year: '1 year',
        never: 'Never',
      },
      create: 'Create token',
    },
    list: {
      title: 'Your tokens',
      empty: 'You have no tokens yet.',
      noExpiry: 'No expiry',
      expired: (date: string) => `Expired ${date}`,
      expires: (date: string) => `Expires ${date}`,
      lastUsed: (date: string) => `Last used ${date}`,
      neverUsed: 'Never used',
      revoke: 'Revoke',
      revokeLabel: (name: string) => `Revoke ${name}`,
    },
  },
  taskTable: {
    key: 'Key',
    title: 'Title',
    project: 'Project',
    status: 'Status',
    priority: 'Priority',
    due: 'Due',
  },
  myTasks: {
    title: 'My tasks',
    showFinished: 'Show finished',
    empty: 'Nothing assigned to you',
    emptyHint: 'Tasks show up here when someone makes you the assignee.',
    count: (count: number) => `${count} ${count === 1 ? 'task' : 'tasks'}, earliest due date first`,
    caption: 'Tasks assigned to you',
  },
  search: {
    title: 'Search',
    resultsFor: (query: string) => `Results for “${query}”`,
    hint: 'Type at least two characters in the search box above. A task key such as CHL-12 finds that task.',
    searching: 'Searching…',
    nothing: 'Nothing found in your projects.',
    tasks: 'Tasks',
    tasksCaption: 'Tasks found',
    pages: 'Wiki pages',
  },
  notifications: {
    title: 'Notifications',
    /** Accessible name of the bell in the header. */
    bellLabel: (unread: number) =>
      unread > 0 ? `Notifications, ${unread} unread` : 'Notifications',
    markAllRead: 'Mark all as read',
    empty:
      'Nothing yet. You will hear here when someone assigns you a task, comments on a task of yours or mentions you with @.',
    /** Read out before an unread notification. */
    unreadPrefix: 'Unread: ',
    wikiPage: (title: string) => `wiki page “${title}”`,
    /**
     * The line of a notification, as pieces in reading order. `actor` is who did it and
     * `subject` the link to the task, page or project; each language places them itself.
     */
    sentence: {
      task_assigned: <T>(actor: T, subject: T): (T | string)[] => [
        actor,
        ' assigned you ',
        subject,
      ],
      task_moved: <T>(actor: T, subject: T): (T | string)[] => [actor, ' moved ', subject],
      task_commented: <T>(actor: T, subject: T): (T | string)[] => [
        actor,
        ' commented on ',
        subject,
      ],
      mentioned: <T>(actor: T, subject: T): (T | string)[] => [
        actor,
        ' mentioned you in ',
        subject,
      ],
    },
  },
}

export type ShellMessages = typeof shell
