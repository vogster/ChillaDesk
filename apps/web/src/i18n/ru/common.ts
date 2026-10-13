import type { CommonMessages } from '../en/common'
import { serverText } from './serverText'

export const common: CommonMessages = {
  appName: 'ChillaDesk',
  language: 'Язык',
  loading: 'Загрузка…',
  save: 'Сохранить',
  cancel: 'Отмена',
  delete: 'Удалить',
  edit: 'Изменить',
  close: 'Закрыть',
  add: 'Добавить',
  create: 'Создать',
  someone: 'Кто-то',
  deletedUser: 'Удалённый пользователь',
  priority: {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий',
    urgent: 'Срочный',
  },
  role: {
    owner: 'Владелец',
    member: 'Участник',
    viewer: 'Наблюдатель',
  },
  errors: {
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
    byCode: {
      UNAUTHENTICATED: 'Нужно войти в систему.',
      FORBIDDEN: 'Недостаточно прав для этого действия.',
      NOT_FOUND: 'Не найдено.',
      RATE_LIMITED: 'Слишком много запросов. Подождите немного и попробуйте снова.',
      INTERNAL_ERROR: 'Ошибка на сервере. Попробуйте ещё раз.',
      NETWORK_ERROR: 'Нет связи с сервером. Проверьте подключение.',
      UNEXPECTED_RESPONSE: 'Сервер прислал неожиданный ответ.',
    },
    serverText,
  },
}
