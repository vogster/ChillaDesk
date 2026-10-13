/** Texts about the user's own account: the profile and what belongs to it. */
export const account = {
  profile: {
    link: (name: string) => `Profile of ${name}`,
    title: 'Profile',
    details: 'Your details',
    name: 'Name',
    email: 'Email',
    emailVerified: 'confirmed',
    emailNotVerified: 'not confirmed',
    saveName: 'Save name',
    saved: 'Saved',
    language: 'Language',
    languageHint:
      'Used for the interface, for the columns of projects you create and for emails to you.',
    notifications: 'Notifications',
    emailNotifications: 'Also send my notifications by email',
    emailNotificationsHint:
      'Emails go out only if the server is set up to send them. In the app you get every notification either way.',
    password: 'Password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    changePassword: 'Change password',
    passwordChanged: 'Password changed. Your other devices were signed out.',
  },
  invites: {
    heading: 'Invite links',
    hint: 'Anyone with the link who has an account, or creates one, can join this project. A link works for a week and for any number of people.',
    role: 'Join as',
    create: 'Create invite link',
    created: 'Send this link to the people you want here. It is shown only now.',
    linkLabel: 'Invite link',
    copy: 'Copy link',
    copied: 'Copied',
    listLabel: 'Open invite links',
    validUntil: (date: string) => `valid until ${date}`,
    revoke: 'Revoke',
    revokeLabel: (role: string, date: string) => `Revoke the ${role} link valid until ${date}`,
    page: {
      title: 'Invitation',
      invitation: (project: string, role: string) =>
        `You are invited to join the project “${project}” as ${role}.`,
      join: 'Join the project',
      alreadyMember: (project: string) => `You are already in the project “${project}”.`,
      open: 'Open the project',
      invalid: 'This invite link does not work any more. Ask for a new one.',
    },
  },
}

export type AccountMessages = typeof account
