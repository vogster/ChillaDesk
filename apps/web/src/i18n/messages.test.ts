import { emailSchema } from '@chilladesk/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, errorMessage } from '../api/client'
import { parseForm } from '../components/form'
import {
  applyLocale,
  currentLocale,
  currentMessages,
  detectLocale,
  intlLocale,
  messagesFor,
  rememberLocale,
  ruPlural,
} from './messages'
import { serverText } from './ru/serverText'

function browserLanguages(...languages: string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0] ?? '')
}

afterEach(() => {
  applyLocale('en')
})

describe('detectLocale', () => {
  it('takes the first of the browser languages that is available', () => {
    browserLanguages('de-DE', 'ru-RU', 'en-US')
    expect(detectLocale()).toBe('ru')

    browserLanguages('en-GB', 'ru')
    expect(detectLocale()).toBe('en')
  })

  it('falls back to English for languages it does not have', () => {
    browserLanguages('ja-JP')
    expect(detectLocale()).toBe('en')

    browserLanguages()
    expect(detectLocale()).toBe('en')
  })

  it('prefers what the user chose before, and ignores a stored value it does not know', () => {
    browserLanguages('en-US')
    rememberLocale('ru')
    expect(detectLocale()).toBe('ru')

    localStorage.setItem('cw_locale', 'xx')
    expect(detectLocale()).toBe('en')
  })

  it('works when storage is blocked', () => {
    browserLanguages('ru-RU')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => rememberLocale('en')).not.toThrow()
    expect(detectLocale()).toBe('ru')
  })
})

describe('applyLocale', () => {
  it('switches the texts used outside React and the language of the page', () => {
    applyLocale('ru')

    expect(currentLocale()).toBe('ru')
    expect(currentMessages()).toBe(messagesFor('ru'))
    expect(document.documentElement.lang).toBe('ru')
    expect(currentMessages().common.save).toBe('Сохранить')
  })

  it('makes validation messages follow the language', () => {
    const english = parseForm(emailSchema, 'nope')
    applyLocale('ru')
    const russian = parseForm(emailSchema, 'nope')

    expect(english).toMatchObject({ ok: false })
    expect(russian).toMatchObject({ ok: false })
    const text = (result: typeof english) => (result.ok ? '' : Object.values(result.errors)[0])
    expect(text(russian)).not.toBe(text(english))
    expect(text(russian)).toMatch(/[а-яё]/i)
  })
})

describe('errorMessage', () => {
  const error = (code: ApiError['code'], message: string) => new ApiError(code, message, 400)

  it('shows the server text as it came in English', () => {
    expect(errorMessage(error('CONFLICT', 'A label named "bug" already exists'))).toBe(
      'A label named "bug" already exists',
    )
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.')
  })

  it('translates known server texts into Russian, with the names in them', () => {
    applyLocale('ru')

    expect(errorMessage(error('UNAUTHENTICATED', 'Invalid email or password'))).toBe(
      'Неверный email или пароль',
    )
    expect(errorMessage(error('CONFLICT', 'A label named "bug" already exists'))).toBe(
      'Метка «bug» уже есть',
    )
    expect(errorMessage(error('NOT_FOUND', 'Task not found'))).toBe('Задача не найдена')
    expect(errorMessage(error('FORBIDDEN', 'This action requires the owner role'))).toBe(
      'Для этого действия нужна роль владельца',
    )
  })

  it('falls back to a general Russian text for the kind of error, else to the server text', () => {
    applyLocale('ru')

    expect(errorMessage(error('RATE_LIMITED', 'Too many requests, retry in 1 minute'))).toMatch(
      /Слишком много запросов/,
    )
    expect(errorMessage(error('INTERNAL_ERROR', 'Internal server error'))).toBe(
      'Ошибка на сервере. Попробуйте ещё раз.',
    )
    expect(errorMessage(error('NOT_FOUND', 'Gadget not found'))).toBe('Не найдено')
    expect(errorMessage(error('VALIDATION_ERROR', 'Unknown status "X". This project has: A'))).toBe(
      'Unknown status "X". This project has: A',
    )
    expect(errorMessage(new Error('boom'))).toBe('Что-то пошло не так. Попробуйте ещё раз.')
  })
})

describe('serverText', () => {
  it('returns null for a text it does not know and stays fast on a long one', () => {
    expect(serverText('Completely new message')).toBeNull()

    const started = Date.now()
    serverText(`A label named "${'"'.repeat(200_000)}`)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('intlLocale and ruPlural', () => {
  it('keeps the browser locale when it is already in the chosen language', () => {
    browserLanguages('en-GB')
    expect(intlLocale('en')).toBe('en-GB')
    expect(intlLocale('ru')).toBe('ru')
  })

  it('picks the Russian plural form', () => {
    const tasks = (count: number) => ruPlural(count, 'задача', 'задачи', 'задач')

    expect([1, 2, 5, 11, 21, 22, 25, 101, 0].map(tasks)).toEqual([
      'задача',
      'задачи',
      'задач',
      'задач',
      'задача',
      'задачи',
      'задач',
      'задача',
      'задач',
    ])
  })
})
