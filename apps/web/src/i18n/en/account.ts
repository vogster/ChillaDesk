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
    emailSection: 'Email address',
    newEmail: 'New address',
    yourPassword: 'Your password',
    changeEmail: 'Change address',
    changeEmailHint:
      'A link goes to the new address. The change is made when you open it while signed in.',
    changeEmailSent: (email: string) =>
      `Check ${email} and open the link there. Until then your address stays as it is.`,
    emailChanged: 'Address changed.',
    deleteSection: 'Delete account',
    deleteHint:
      'Projects only you are in are deleted with your account. In shared projects your tasks, pages and comments stay, under “deleted user”. This cannot be undone.',
    deleteAccount: 'Delete my account',
    handOver: 'First make someone else an owner of these projects:',
    passwordChanged:
      'Password changed. Your other devices were signed out. API tokens keep working: revoke them on the API tokens page if someone else may have them.',
  },
  email: {
    backToLogin: 'Back to log in',
    badLink: 'This link is incomplete. Open the link from the email again, or ask for a new one.',
    forgotLink: 'Forgot your password?',
    forgot: {
      title: 'Reset your password',
      hint: 'Enter the email address of your account and we will send you a link to choose a new password.',
      submit: 'Send the link',
      sent: 'If there is an account for this address, a link is on its way. It works for one hour.',
    },
    reset: {
      title: 'Choose a new password',
      submit: 'Set the new password',
      done: 'Your password was changed, every device was signed out and your API tokens were revoked. You can log in with the new password now.',
    },
    change: {
      title: 'New email address',
      done: 'Your account now uses this address.',
    },
    verify: {
      title: 'Email confirmation',
      done: 'Thank you, your email address is confirmed.',
      continue: 'Go to ChillaDesk',
      send: 'Send a confirmation email',
      sent: 'Sent. Open the link in the email within two days.',
      why: 'Notification emails are sent only to a confirmed address.',
      finishHint: 'Enter the password you chose when signing up to confirm the address and log in.',
      finish: 'Confirm and log in',
    },
  },
  invites: {
    heading: 'Invite links',
    hint: 'Anyone with the link who has an account, or creates one, can join this project. A link works for a week and for any number of people. Removing a member revokes every link.',
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
