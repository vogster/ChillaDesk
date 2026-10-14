/** Server texts that never vary, by their English wording. */
const EXACT: Record<string, string> = {
  'Invalid email or password': 'Неверный email или пароль',
  'The current password is wrong': 'Текущий пароль неверен',
  'This link is not valid any more, ask for a new one':
    'Эта ссылка больше не действует. Запросите новую.',
  'This email address is confirmed already': 'Этот адрес почты уже подтверждён',
  'The email could not be sent, try again later': 'Не удалось отправить письмо. Попробуйте позже.',
  'This server is not set up to send email': 'На этом сервере не настроена отправка почты',
  'Too many emails requested, try again later': 'Запрошено слишком много писем. Попробуйте позже.',
  'This invite link is not valid any more': 'Эта ссылка-приглашение больше не действует',
  'This project has too many invite links, revoke some first':
    'У проекта слишком много ссылок-приглашений. Сначала отзовите часть.',
  'Invite not found': 'Приглашение не найдено',
  'An account with this email already exists': 'Аккаунт с таким email уже существует',
  'Registration is disabled on this server': 'Регистрация на этом сервере отключена',
  'Registration is by invitation only; open the invite link you were sent':
    'Регистрация только по приглашениям: откройте присланную вам ссылку-приглашение',
  'This user is already a member of the project': 'Этот пользователь уже участвует в проекте',
  'User with this email not found': 'Пользователь с таким email не найден',
  'A project must keep at least one owner': 'У проекта должен остаться хотя бы один владелец',
  'A board must keep at least one status': 'На доске должна остаться хотя бы одна колонка',
  'Only the author can edit a comment': 'Изменить комментарий может только его автор',
  'Only the author or a project owner can delete a comment':
    'Удалить комментарий может только его автор или владелец проекта',
  'A page cannot be moved under itself or its own subpages':
    'Страницу нельзя перенести в неё саму или в её подстраницы',
  'Changed meanwhile': 'Страницу тем временем изменили',
  'This API token is read-only': 'Этот API-токен только для чтения',
  'This action needs a signed-in session, not an API token':
    'Для этого действия нужен вход в систему, а не API-токен',
  'Cross-site request blocked': 'Запрос с другого сайта заблокирован',
  'Too many open event streams, close some first':
    'Открыто слишком много вкладок с ChillaDesk. Закройте лишние.',
  'These two tasks are linked already': 'Эти две задачи уже связаны',
  'A task cannot be linked to itself': 'Задачу нельзя связать с ней самой',
  'Checklist item not found': 'Пункт чек-листа не найден',
  'Link not found': 'Связь не найдена',
  'You have too many saved filters in this project, delete some first':
    'У вас слишком много сохранённых фильтров в этом проекте. Сначала удалите часть.',
  'Tasks must not repeat': 'Задачи не должны повторяться',
  'The file is empty': 'Файл пуст',
  'The file is too large': 'Файл слишком большой',
  'This project has no room for more files, remove some first':
    'В проекте не осталось места для файлов. Сначала удалите часть.',
  'Attachment not found': 'Файл не найден',
  'Must not contain null characters': 'Текст не должен содержать нулевых символов',
  'At least one field is required': 'Нужно изменить хотя бы одно поле',
  'Labels must not repeat': 'Метки не должны повторяться',
  'Year must be 1900-2999': 'Год должен быть от 1900 до 2999',
  'No title': 'Нет названия',
  'The file has no Title (or Summary) column': 'В файле нет колонки Title (или Summary)',
  'The file is not JSON; export the Trello board as JSON':
    'Это не JSON. Выгрузите доску Trello в формате JSON.',
  'The file is not a Trello board export': 'Это не выгрузка доски Trello',
  'This project has too many labels, delete some first':
    'В проекте слишком много меток. Сначала удалите часть.',
  'The wiki has too many pages to export': 'В вики слишком много страниц для выгрузки',
  'Webhooks cannot point at private addresses on this server':
    'На этом сервере вебхуки не могут вести на внутренние адреса',
  'This project has too many webhooks, delete some first':
    'У проекта слишком много вебхуков. Сначала удалите часть.',
  'Turn the webhook on to send it a test': 'Включите вебхук, чтобы отправить проверку',
  'Must be an http:// or https:// address': 'Нужен адрес http:// или https://',
  'Choose at least one event': 'Выберите хотя бы одно событие',
  'Events must not repeat': 'События не должны повторяться',
  'The webhook was turned off': 'Вебхук выключили',
  'The address could not be found or is not public': 'Адрес не найден или не публичный',
  'Webhooks can use ports 80, 443 and 1024 and above':
    'Вебхуки могут использовать порты 80, 443 и от 1024',
  'Whoever added this webhook no longer owns the project':
    'Тот, кто добавил вебхук, больше не владелец проекта',
  'The address was changed': 'Адрес изменили',
  'The password is wrong': 'Неверный пароль',
  'This is the address of your account already': 'Это уже адрес вашей учётной записи',
  'Make someone else an owner of your projects with other members first':
    'Сначала назначьте другого владельца в проектах, где есть другие участники',
  'Too many login attempts for this account, retry later':
    'Слишком много попыток входа в эту учётную запись. Попробуйте позже.',
  'The connection was refused': 'Соединение отклонено',
  'The connection was dropped': 'Соединение оборвалось',
  'The TLS certificate was not accepted': 'TLS-сертификат не принят',
  'The delivery could not be sent': 'Доставку не удалось отправить',
}

const SHORTENED: Record<string, string> = {
  Titles: 'Названия',
  Descriptions: 'Описания',
  'Checklist items': 'Пункты чек-листов',
}

const THINGS: Record<string, string> = {
  Comment: 'Комментарий не найден',
  Webhook: 'Вебхук не найден',
  Label: 'Метка не найдена',
  Milestone: 'Веха не найдена',
  Member: 'Участник не найден',
  Project: 'Проект не найден',
  Status: 'Колонка не найдена',
  Task: 'Задача не найдена',
  Token: 'Токен не найден',
  Version: 'Версия не найдена',
  'Wiki page': 'Страница вики не найдена',
}

const ROLES: Record<string, string> = {
  owner: 'владельца',
  member: 'участника',
  viewer: 'наблюдателя',
}

/** Server texts with a name inside. Each pattern is anchored and has no nested repetition. */
const PATTERNS: [RegExp, (...groups: string[]) => string][] = [
  [/^You already have a filter named "(.+)"$/, (name) => `У вас уже есть фильтр «${name}»`],
  [/^A label named "(.+)" already exists$/, (name) => `Метка «${name}» уже есть`],
  [/^A milestone named "(.+)" already exists$/, (name) => `Веха «${name}» уже есть`],
  [/^A page titled "(.+)" already exists$/, (title) => `Страница «${title}» уже есть`],
  [/^Project key "(.+)" is already taken$/, (key) => `Ключ проекта «${key}» уже занят`],
  [
    /^This action requires the (owner|member|viewer) role$/,
    (role) => `Для этого действия нужна роль ${ROLES[role] ?? role}`,
  ],
  [
    /^Too many requests, retry in (.+)$/,
    () => 'Слишком много запросов. Подождите немного и попробуйте снова.',
  ],
  [
    /^At most (\d+) files can be attached here$/,
    (max) => `Сюда можно прикрепить не больше ${max} файлов`,
  ],
  [
    /^A file can bring in at most (\d+) tasks at once$/,
    (max) => `За один раз можно импортировать не больше ${max} задач`,
  ],
  [/^Added the column "(.+)"$/, (name) => `Добавлена колонка «${name}»`],
  [
    /^No column "(.+)"; its tasks were put into the first column$/,
    (name) => `Колонки «${name}» нет; её задачи попали в первую колонку`,
  ],
  [
    /^Unknown priority "(.+)"; medium was used$/,
    (value) => `Неизвестный приоритет «${value}»; поставлен средний`,
  ],
  [
    /^"(.+)" is not a member of this project; left unassigned$/,
    (who) => `«${who}» не участвует в проекте; задача оставлена без исполнителя`,
  ],
  [/^Could not read the date "(.+)"$/, (value) => `Не удалось прочитать дату «${value}»`],
  [
    /^A task can have at most (\d+) labels; the rest were left out$/,
    (max) => `У задачи может быть не больше ${max} меток; остальные пропущены`,
  ],
  [
    /^A checklist can have at most (\d+) items; the rest were left out$/,
    (max) => `В чек-листе может быть не больше ${max} пунктов; остальные пропущены`,
  ],
  [
    /^The project has too many labels; "(.+)" was not added$/,
    (name) => `В проекте слишком много меток; «${name}» не добавлена`,
  ],
  [
    /^The project has too many milestones; "(.+)" was not added$/,
    (name) => `В проекте слишком много вех; «${name}» не добавлена`,
  ],
  [
    /^(Titles|Descriptions|Checklist items) longer than (\d+) characters were shortened$/,
    (what, max) => `${SHORTENED[what] ?? what} длиннее ${max} символов были сокращены`,
  ],
  [/^Archived card "(.+)"$/, (name) => `Карточка «${name}» в архиве`],
  [/^The receiver answered HTTP (\d+)$/, (status) => `Получатель ответил HTTP ${status}`],
  [/^No answer within (\d+) s$/, (seconds) => `Нет ответа за ${seconds} с`],
  [/^(\S+) is not a public address$/, (host) => `${host} — не публичный адрес`],
  [/^(.+) not found$/, (what) => THINGS[what] ?? 'Не найдено'],
]

/** The Russian for a text written by the server, or null when there is none. */
export function serverText(message: string): string | null {
  const exact = EXACT[message]
  if (exact !== undefined) return exact
  for (const [pattern, translate] of PATTERNS) {
    const match = pattern.exec(message)
    if (match) return translate(...match.slice(1))
  }
  return null
}
