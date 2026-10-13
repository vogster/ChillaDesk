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
  invites: {
    heading: 'Ссылки-приглашения',
    hint: 'По ссылке в проект может войти любой, у кого есть учётная запись или кто её создаст. Ссылка действует неделю и подходит для любого числа людей.',
    role: 'Роль',
    create: 'Создать ссылку',
    created: 'Отправьте эту ссылку тем, кого хотите пригласить. Она показывается только сейчас.',
    linkLabel: 'Ссылка-приглашение',
    copy: 'Скопировать ссылку',
    copied: 'Скопировано',
    listLabel: 'Действующие ссылки-приглашения',
    validUntil: (date) => `действует до ${date}`,
    revoke: 'Отозвать',
    revokeLabel: (role, date) => `Отозвать ссылку с ролью «${role}», действующую до ${date}`,
    page: {
      title: 'Приглашение',
      invitation: (project, role) => `Вас приглашают в проект «${project}». Роль: ${role}.`,
      join: 'Войти в проект',
      alreadyMember: (project) => `Вы уже участвуете в проекте «${project}».`,
      open: 'Открыть проект',
      invalid: 'Эта ссылка-приглашение больше не действует. Попросите новую.',
    },
  },
}
