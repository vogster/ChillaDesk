import type { ShellMessages } from '../en/shell'
import { ruPlural } from '../messages'

export const shell: ShellMessages = {
  app: {
    tryAgain: 'Повторить',
  },
  nav: {
    main: 'Основная навигация',
    projects: 'Проекты',
    myTasks: 'Мои задачи',
    tokens: 'API-токены',
    logOut: 'Выйти',
    search: 'Поиск по задачам и вики',
  },
  markdown: {
    missingPage: 'Этой страницы ещё нет. Перейдите по ссылке, чтобы создать её.',
  },
  auth: {
    email: 'Эл. почта',
    password: 'Пароль',
    name: 'Имя',
    login: {
      title: 'Вход',
      submit: 'Войти',
      submitting: 'Вход…',
      noAccount: 'Ещё не зарегистрированы?',
      signUp: 'Зарегистрироваться',
    },
    register: {
      title: 'Регистрация',
      submit: 'Зарегистрироваться',
      submitting: 'Регистрация…',
      haveAccount: 'Уже зарегистрированы?',
      logIn: 'Войти',
      passwordHint: (min) => `Не менее ${min} ${ruPlural(min, 'символа', 'символов', 'символов')}`,
      checkEmail: (email) =>
        `Почти готово. Мы отправили ссылку на ${email}: откройте её, чтобы завершить регистрацию. Если с этим адресом уже есть учётная запись, в письме будет сказано об этом.`,
    },
  },
  notFound: {
    title: 'Страница не найдена',
    back: 'К вашим проектам',
  },
  projects: {
    title: 'Проекты',
    newProject: 'Новый проект',
    name: 'Название',
    key: 'Ключ',
    keyHint: 'Префикс для номеров задач',
    description: 'Описание',
    create: 'Создать проект',
    creating: 'Создание…',
    empty: 'Пока нет проектов',
    emptyHint: 'Создайте первый проект, чтобы вести задачи и писать документацию.',
  },
  tokens: {
    title: 'API-токены',
    intro:
      'Токен позволяет скрипту или ИИ-ассистенту работать с вашими проектами от вашего имени — через REST API или MCP. Токен только для чтения позволяет смотреть, но ничего не менять.',
    scope: {
      read: 'Только чтение',
      write: 'Чтение и запись',
    },
    notice: {
      created: (name) => `Токен «${name}» создан`,
      copyNow:
        'Скопируйте его сейчас. В целях безопасности он не хранится, и показать его снова нельзя.',
      tokenLabel: 'Новый API-токен',
      copyToken: 'Скопировать токен',
      copied: 'Скопировано',
      mcpTitle: 'Подключение ИИ-ассистента (MCP)',
      mcpHint: 'Добавьте этот сервер в конфигурацию вашего MCP-клиента:',
      configLabel: 'Конфигурация MCP-клиента',
      copyConfig: 'Скопировать конфигурацию',
      done: 'Готово',
    },
    form: {
      title: 'Новый токен',
      name: 'Название',
      namePlaceholder: 'например, Claude на моём ноутбуке',
      access: 'Доступ',
      expires: 'Срок действия',
      expiry: {
        days30: '30 дней',
        days90: '90 дней',
        year: '1 год',
        never: 'Бессрочно',
      },
      create: 'Создать токен',
    },
    list: {
      title: 'Ваши токены',
      empty: 'У вас пока нет токенов.',
      noExpiry: 'Бессрочный',
      expired: (date) => `Истёк ${date}`,
      expires: (date) => `Действует до ${date}`,
      lastUsed: (date) => `Последнее использование: ${date}`,
      neverUsed: 'Не использовался',
      revoke: 'Отозвать',
      revokeLabel: (name) => `Отозвать токен «${name}»`,
    },
  },
  taskTable: {
    key: 'Ключ',
    title: 'Название',
    project: 'Проект',
    status: 'Колонка',
    priority: 'Приоритет',
    due: 'Срок',
  },
  myTasks: {
    title: 'Мои задачи',
    showFinished: 'Показывать завершённые',
    empty: 'Вам ничего не назначено',
    emptyHint: 'Задачи появятся здесь, когда вас назначат исполнителем.',
    count: (count) =>
      `${count} ${ruPlural(count, 'задача', 'задачи', 'задач')}, сначала с ближайшим сроком`,
    caption: 'Задачи, назначенные вам',
  },
  search: {
    title: 'Поиск',
    resultsFor: (query) => `Результаты по запросу «${query}»`,
    hint: 'Введите не меньше двух символов в строке поиска вверху. По ключу задачи, например CHL-12, находится сама задача.',
    searching: 'Поиск…',
    nothing: 'В ваших проектах ничего не найдено.',
    tasks: 'Задачи',
    tasksCaption: 'Найденные задачи',
    pages: 'Страницы вики',
  },
  notifications: {
    title: 'Уведомления',
    bellLabel: (unread) =>
      unread > 0
        ? `Уведомления, ${unread} ${ruPlural(unread, 'непрочитанное', 'непрочитанных', 'непрочитанных')}`
        : 'Уведомления',
    markAllRead: 'Отметить все как прочитанные',
    empty:
      'Пока ничего нет. Здесь появятся уведомления, когда вам назначат задачу, прокомментируют вашу задачу или упомянут вас через @.',
    unreadPrefix: 'Не прочитано: ',
    wikiPage: (title) => `страница вики «${title}»`,
    // Worded without a verb for the actor, whose gender is not known.
    sentence: {
      task_assigned: (actor, subject) => [actor, ': вам назначена задача ', subject],
      task_moved: (actor, subject) => [actor, ': задача перенесена — ', subject],
      task_commented: (actor, subject) => [actor, ': новый комментарий к задаче ', subject],
      mentioned: (actor, subject) => [actor, ': упоминание — ', subject],
    },
  },
}
