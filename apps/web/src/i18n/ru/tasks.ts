import type { DragItem, TasksMessages } from '../en/tasks'
import { ruPlural } from '../messages'

/** «из 21 задачи», «из 5 задач». */
const ofTasks = (total: number) => ruPlural(total, 'задачи', 'задач', 'задач')

type Case = 'nominative' | 'genitive' | 'accusative' | 'instrumental'

const NOUNS: Record<DragItem['kind'], Record<Case, string>> = {
  task: { nominative: 'задача', genitive: 'задачи', accusative: 'задачу', instrumental: 'задачей' },
  column: {
    nominative: 'колонка',
    genitive: 'колонки',
    accusative: 'колонку',
    instrumental: 'колонкой',
  },
}

/** «задачу CHL-1 Название», «колонкой «В работе»»; without a name only the noun. */
const dragItem = ({ kind, name }: DragItem, form: Case): string => {
  const noun = NOUNS[kind][form]
  if (name === null) return noun
  return kind === 'column' ? `${noun} «${name}»` : `${noun} ${name}`
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export const tasks: TasksMessages = {
  layout: {
    backToProjects: '← Проекты',
    sections: 'Разделы проекта',
    board: 'Доска',
    list: 'Список',
    wiki: 'Вики',
    milestones: 'Вехи',
    members: 'Участники',
    settings: 'Настройки',
  },
  board: {
    truncated: (shown, total) =>
      `Показаны первые ${shown} из ${total} ${ofTasks(total)}. Остальные можно найти в списке.`,
    countNoun: (count) => ruPlural(count, 'задача', 'задачи', 'задач'),
    addTo: (column) => `Добавить задачу в колонку «${column}»`,
    addTask: '+ Добавить задачу',
    newTitleIn: (column) => `Название новой задачи в колонке «${column}»`,
    newTitlePlaceholder: 'Что нужно сделать?',
    done: 'Готово',
    move: (title) => `Переместить задачу «${title}»`,
    drag: {
      roleDescription: 'перетаскиваемый элемент',
      instructions:
        'Чтобы взять элемент, нажмите пробел. Перемещайте его клавишами со стрелками. Нажмите пробел ещё раз, чтобы оставить элемент на новом месте, или Escape, чтобы отменить.',
      describe: (item) => dragItem(item, 'nominative'),
      pickedUp: (item) => `Вы взяли ${dragItem(item, 'accusative')}.`,
      over: (item, target) =>
        `${capitalized(dragItem(item, 'nominative'))} над ${dragItem(target, 'instrumental')}.`,
      notOver: (item) => `${capitalized(dragItem(item, 'nominative'))} вне колонок.`,
      dropped: (item, target) =>
        target.kind === 'column'
          ? `${capitalized(dragItem(item, 'nominative'))} перенесена в ${dragItem(target, 'accusative')}.`
          : `${capitalized(dragItem(item, 'nominative'))} поставлена на место ${dragItem(target, 'genitive')}.`,
      putBack: (item) => `${capitalized(dragItem(item, 'nominative'))} возвращена на место.`,
      cancelled: (item) => `Перемещение ${dragItem(item, 'genitive')} отменено.`,
    },
  },
  list: {
    search: 'Поиск',
    searchPlaceholder: 'Название или описание',
    status: 'Колонка',
    anyStatus: 'Любая колонка',
    assignee: 'Исполнитель',
    anyone: 'Любой',
    unassigned: 'Без исполнителя',
    priority: 'Приоритет',
    anyPriority: 'Любой приоритет',
    label: 'Метка',
    anyLabel: 'Любая метка',
    milestone: 'Веха',
    anyMilestone: 'Любая веха',
    noMilestone: 'Без вехи',
    noMatches: 'Под эти фильтры не подходит ни одна задача.',
    empty: 'Задач пока нет. Добавьте первую на доске.',
    count: (total) => `${total} ${ruPlural(total, 'задача', 'задачи', 'задач')}`,
    showing: (shown, total) => `Показано ${shown} из ${total} ${ofTasks(total)}`,
    sortBy: (column) => `Сортировать по столбцу «${column}»`,
    selectAll: 'Выбрать все задачи',
    selectTask: (key) => `Выбрать задачу ${key}`,
    bulk: {
      label: 'Действия с выбранными задачами',
      selected: (count) => `Выбрано: ${count}`,
      moveTo: 'Перенести в…',
      assignTo: 'Назначить…',
      setPriority: 'Приоритет…',
      setMilestone: 'Веха…',
      delete: 'Удалить',
      deleteConfirm: (count) =>
        `Удалить ${count} ${ruPlural(count, 'задачу', 'задачи', 'задач')} вместе с комментариями? Это действие нельзя отменить.`,
      clear: 'Снять выбор',
    },
    saved: {
      label: 'Сохранённые фильтры',
      choose: 'Сохранённые фильтры…',
      save: 'Сохранить фильтр',
      name: 'Название фильтра',
      cancel: 'Отмена',
      delete: (name) => `Удалить фильтр «${name}»`,
    },
    columns: {
      key: 'Ключ',
      title: 'Название',
      status: 'Колонка',
      priority: 'Приоритет',
      assignee: 'Исполнитель',
      due: 'Срок',
    },
  },
  dialog: {
    label: 'Задача',
    missing: 'Этой задачи больше нет.',
    title: 'Название',
    description: 'Описание',
    descriptionPlaceholder: 'Поддерживается Markdown.',
    noDescription: 'Описания нет.',
    status: 'Колонка',
    priority: 'Приоритет',
    assignee: 'Исполнитель',
    unassigned: 'Не назначен',
    dueDate: 'Срок',
    milestone: 'Веха',
    noMilestone: 'Нет',
    noDueDate: 'Не указан',
    dueDateInvalid: 'Введите год от 1900 до 2999.',
    created: (author, date) => `Автор: ${author ?? 'удалённый пользователь'}, создана ${date}`,
    deleteConfirm: 'Удалить эту задачу вместе с комментариями? Это действие нельзя отменить.',
    deleteYes: 'Да, удалить',
    deleteTask: 'Удалить задачу…',
  },
  comments: {
    heading: 'Комментарии',
    empty: 'Комментариев пока нет.',
    emptyBody: 'Сначала напишите комментарий.',
    edited: '(изменён)',
    editedAt: (time) => `Изменён ${time}`,
    editYours: (time) => `Изменить ваш комментарий от ${time}`,
    deleteBy: (author) =>
      author === null
        ? 'Удалить комментарий удалённого пользователя'
        : `Удалить комментарий пользователя ${author}`,
    editLabel: 'Изменение комментария',
    save: 'Сохранить комментарий',
    addLabel: 'Добавить комментарий',
    addPlaceholder: 'Добавьте комментарий… Поддерживается Markdown, @ — упоминание участника.',
    submit: 'Отправить',
  },
  display: {
    overdue: 'Просрочено: ',
    assignedTo: (name) => `Исполнитель: ${name}`,
  },
  labels: {
    listLabel: 'Метки',
    colors: {
      gray: 'Серый',
      red: 'Красный',
      orange: 'Оранжевый',
      yellow: 'Жёлтый',
      green: 'Зелёный',
      teal: 'Бирюзовый',
      blue: 'Синий',
      purple: 'Фиолетовый',
      pink: 'Розовый',
    },
    none: 'Меток нет',
    editLabels: 'Изменить метки',
    done: 'Готово',
    projectHasNone: 'В этом проекте пока нет меток.',
    invalidName: 'Недопустимое название',
    newLabel: 'Новая метка',
    newColor: 'Цвет новой метки',
    create: 'Создать метку',
    settings: {
      heading: 'Метки',
      hint: 'При удалении метка снимается со всех задач, на которых она стоит.',
      empty: 'Меток пока нет.',
      nameOf: (label) => `Название метки «${label}»`,
      colorOf: (label) => `Цвет метки «${label}»`,
      deleteLabel: (label) => `Удалить метку «${label}»`,
      newLabel: 'Новая метка',
      color: 'Цвет',
      add: 'Добавить метку',
    },
  },
  mentions: {
    listLabel: 'Упомянуть участника',
  },
  checklist: {
    heading: 'Чек-лист',
    progress: (done, total) => `выполнено ${done} из ${total}`,
    badge: (done, total) => `Чек-лист: выполнено ${done} из ${total}`,
    newItem: 'Новый пункт чек-листа',
    removeItem: (text) => `Убрать из чек-листа пункт «${text}»`,
  },
  links: {
    heading: 'Связанные задачи',
    relationLabel: 'Связь',
    taskLabel: 'Номер задачи',
    add: 'Связать',
    done: '(выполнена)',
    removeLink: (key) => `Убрать связь с задачей ${key}`,
    invalidTask: (projectKey) =>
      `Введите номер задачи этого проекта, например 12 или ${projectKey}-12.`,
    relation: {
      blocks: 'блокирует',
      blocked_by: 'заблокирована задачей',
      duplicates: 'дублирует',
      duplicated_by: 'продублирована задачей',
      subtask_of: 'подзадача для',
      parent_of: 'включает подзадачу',
      relates_to: 'связана с',
    },
  },
  watch: {
    start: 'Следить',
    stop: 'Не следить',
    count: (count) => `Следят: ${count}`,
    hint: 'Тем, кто следит, приходят уведомления о новых комментариях и о переносе задачи в другую колонку.',
  },
  history: {
    heading: 'История',
    created: 'Задача создана',
    title: (from, to) => `Название: «${from}» → «${to}»`,
    description: 'Описание изменено',
    status: (from, to) => `Колонка: ${from} → ${to}`,
    priority: (from, to) => `Приоритет: ${from} → ${to}`,
    assignee: (from, to) => `Исполнитель: ${from ?? 'никто'} → ${to ?? 'никто'}`,
    dueDate: (from, to) => `Срок: ${from ?? 'не указан'} → ${to ?? 'не указан'}`,
    milestone: (from, to) => `Веха: ${from ?? 'нет'} → ${to ?? 'нет'}`,
    labels: (added, removed) =>
      `Метки: ${[
        added.length > 0 ? `добавлены ${added.join(', ')}` : '',
        removed.length > 0 ? `убраны ${removed.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ')}`,
  },
}
