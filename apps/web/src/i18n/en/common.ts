/** Words used all over the app. Screens keep their own texts in the other files here. */
export const common = {
  appName: 'ChillaDesk',
  language: 'Language',
  loading: 'Loading…',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  edit: 'Edit',
  close: 'Close',
  add: 'Add',
  create: 'Create',
  someone: 'Someone',
  deletedUser: 'Deleted user',
  priority: {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
  },
  role: {
    owner: 'Owner',
    member: 'Member',
    viewer: 'Viewer',
  },
  errors: {
    generic: 'Something went wrong. Please try again.',
    /**
     * Shown instead of the server's English text for errors that say nothing specific.
     * Empty means: show what the server said.
     */
    byCode: {
      UNAUTHENTICATED: '',
      FORBIDDEN: '',
      NOT_FOUND: '',
      RATE_LIMITED: '',
      INTERNAL_ERROR: '',
      NETWORK_ERROR: '',
      UNEXPECTED_RESPONSE: '',
    },
    /**
     * Translates a text written by the server (an error or a validation message), or
     * returns null to show it as it came. The server always answers in English.
     */
    serverText: (_message: string): string | null => null,
  },
}

export type CommonMessages = typeof common
