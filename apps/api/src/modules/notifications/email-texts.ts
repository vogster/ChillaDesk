import type { NotificationType, UserLocale } from '@chilladesk/shared'

/** The words of a notification email, in the language of its recipient. */
export interface NotificationEmailTexts {
  someone: string
  actions: Record<NotificationType, string>
  onPage: (title: string) => string
  inTask: (taskKeyAndTitle: string) => string
  inProject: (name: string) => string
  /** Why the email came, and where to turn such emails off. */
  footer: (profileLink: string) => string
}

export const NOTIFICATION_EMAIL_TEXTS: Record<UserLocale, NotificationEmailTexts> = {
  en: {
    someone: 'Someone',
    actions: {
      task_assigned: 'assigned you a task',
      task_commented: 'commented on a task',
      task_moved: 'moved a task',
      mentioned: 'mentioned you',
    },
    onPage: (title) => `on the wiki page “${title}”`,
    inTask: (task) => `in ${task}`,
    inProject: (name) => `in ${name}`,
    footer: (link) =>
      `You get this email because you did not see the notification in ChillaDesk. Turn these emails off in your profile: ${link}`,
  },
  ru: {
    someone: 'Кто-то',
    actions: {
      task_assigned: 'назначил(а) вам задачу',
      task_commented: 'прокомментировал(а) задачу',
      task_moved: 'перенёс(ла) задачу',
      mentioned: 'упомянул(а) вас',
    },
    onPage: (title) => `на странице вики «${title}»`,
    inTask: (task) => `в задаче ${task}`,
    inProject: (name) => `в проекте ${name}`,
    footer: (link) =>
      `Это письмо пришло, потому что вы не увидели уведомление в ChillaDesk. Отключить такие письма можно в профиле: ${link}`,
  },
}
