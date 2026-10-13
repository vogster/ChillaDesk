import type { AccountMessages } from '../en/account'

export const account: AccountMessages = {
  profile: {
    link: (name) => `Профиль: ${name}`,
    title: 'Профиль',
    details: 'Ваши данные',
    name: 'Имя',
    email: 'Эл. почта',
    emailVerified: 'подтверждена',
    emailNotVerified: 'не подтверждена',
    saveName: 'Сохранить имя',
    saved: 'Сохранено',
    language: 'Язык',
    languageHint:
      'На этом языке будут интерфейс, колонки в проектах, которые вы создаёте, и письма вам.',
    notifications: 'Уведомления',
    emailNotifications: 'Присылать уведомления ещё и на почту',
    emailNotificationsHint:
      'Письма уходят, только если на сервере настроена отправка почты. В приложении вы получаете все уведомления в любом случае.',
    password: 'Пароль',
    currentPassword: 'Текущий пароль',
    newPassword: 'Новый пароль',
    changePassword: 'Сменить пароль',
    passwordChanged: 'Пароль изменён. На других устройствах выполнен выход.',
  },
}
