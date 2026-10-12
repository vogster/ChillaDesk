/** Server texts that never vary, by their English wording. */
const EXACT: Record<string, string> = {
  'Invalid email or password': 'Неверный email или пароль',
  'An account with this email already exists': 'Аккаунт с таким email уже существует',
  'Registration is disabled on this server': 'Регистрация на этом сервере отключена',
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
    'Открыто слишком много вкладок с ChillaWiki. Закройте лишние.',
  'Must not contain null characters': 'Текст не должен содержать нулевых символов',
  'At least one field is required': 'Нужно изменить хотя бы одно поле',
  'Labels must not repeat': 'Метки не должны повторяться',
  'Year must be 1900-2999': 'Год должен быть от 1900 до 2999',
}

const THINGS: Record<string, string> = {
  Comment: 'Комментарий не найден',
  Label: 'Метка не найдена',
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
  [/^A label named "(.+)" already exists$/, (name) => `Метка «${name}» уже есть`],
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
