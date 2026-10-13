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
}

export type AccountMessages = typeof account
