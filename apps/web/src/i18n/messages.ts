import { z } from 'zod'
import { en as zodEn, ru as zodRu } from 'zod/locales'
import { account as accountEn } from './en/account'
import { common as commonEn } from './en/common'
import { project as projectEn } from './en/project'
import { shell as shellEn } from './en/shell'
import { tasks as tasksEn } from './en/tasks'
import { account as accountRu } from './ru/account'
import { common as commonRu } from './ru/common'
import { project as projectRu } from './ru/project'
import { shell as shellRu } from './ru/shell'
import { tasks as tasksRu } from './ru/tasks'

export const LOCALES = ['en', 'ru'] as const
export type Locale = (typeof LOCALES)[number]

/** How each language calls itself, for the switcher. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский' }

const en = {
  common: commonEn,
  shell: shellEn,
  tasks: tasksEn,
  project: projectEn,
  account: accountEn,
}

/** Every text of the interface. English is the source; other languages must match its shape. */
export type Messages = typeof en

const DICTIONARIES: Record<Locale, Messages> = {
  en,
  ru: {
    common: commonRu,
    shell: shellRu,
    tasks: tasksRu,
    project: projectRu,
    account: accountRu,
  },
}

export const messagesFor = (locale: Locale): Messages => DICTIONARIES[locale]

const STORAGE_KEY = 'cw_locale'

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale)

/** The language chosen earlier, else the first of the browser's languages we have. */
export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // Storage can be blocked; the browser's language still applies.
  }
  const preferred = navigator.languages.length > 0 ? navigator.languages : [navigator.language]
  const known = preferred.map((tag) => tag.toLowerCase().split('-')[0]).find(isLocale)
  return known ?? 'en'
}

/** Whether a language was ever picked on this device (as opposed to guessed). */
export function hasStoredLocale(): boolean {
  try {
    return isLocale(localStorage.getItem(STORAGE_KEY))
  } catch {
    return false
  }
}

export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // The choice then lasts until the page is reloaded.
  }
}

let current: Locale = 'en'

/**
 * Makes a language the current one for code outside React: validation messages, error
 * texts and the page's `lang`. Components read the texts with `useT()` instead.
 */
export function applyLocale(locale: Locale): void {
  current = locale
  // The messages zod writes itself ("Too small: expected…") follow the language too.
  z.config(locale === 'ru' ? zodRu() : zodEn())
  document.documentElement.lang = locale
}

export const currentLocale = (): Locale => current
export const currentMessages = (): Messages => DICTIONARIES[current]

/**
 * The locale for dates and numbers. The browser's own one is kept when it already is in
 * the chosen language, so its regional habits (day first, 24 hours) stay.
 */
export function intlLocale(locale: Locale = current): string | undefined {
  return navigator.language.toLowerCase().startsWith(locale) ? undefined : locale
}

/** Picks the Russian form for a number: 1 задача, 2 задачи, 5 задач. */
export function ruPlural(count: number, one: string, few: string, many: string): string {
  const rule = new Intl.PluralRules('ru').select(count)
  return rule === 'one' ? one : rule === 'few' ? few : many
}
