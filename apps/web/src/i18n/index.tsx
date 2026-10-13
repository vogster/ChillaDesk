import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  applyLocale,
  detectLocale,
  LOCALE_NAMES,
  LOCALES,
  messagesFor,
  rememberLocale,
  type Locale,
  type Messages,
} from './messages'

export { currentMessages, intlLocale, ruPlural, type Locale, type Messages } from './messages'

interface I18n {
  locale: Locale
  setLocale(locale: Locale): void
  t: Messages
}

const I18nContext = createContext<I18n | null>(null)

/** Holds the interface language. Everything below re-renders when it changes. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const detected = detectLocale()
    applyLocale(detected)
    return detected
  })

  const setLocale = useCallback((next: Locale) => {
    rememberLocale(next)
    // Before the re-render, so texts built outside React are already in the new language.
    applyLocale(next)
    setLocaleState(next)
  }, [])

  const value = useMemo<I18n>(
    () => ({ locale, t: messagesFor(locale), setLocale }),
    [locale, setLocale],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useT and useLocale need an <I18nProvider> above them')
  return value
}

/**
 * The texts of the interface in the current language: `const t = useT()`, then
 * `t.common.save` or `t.tasks.count(3)`.
 */
export const useT = (): Messages => useI18n().t

/** The current language and a way to change it. */
export function useLocale(): [Locale, (locale: Locale) => void] {
  const { locale, setLocale } = useI18n()
  return [locale, setLocale]
}

/** Lets the user pick the interface language; shown in the header and on the sign-in pages. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()
  return (
    <select
      aria-label={t.common.language}
      value={locale}
      onChange={(event) => setLocale(event.target.value as Locale)}
      className={`rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 ${className}`}
    >
      {LOCALES.map((code) => (
        <option key={code} value={code} lang={code}>
          {LOCALE_NAMES[code]}
        </option>
      ))}
    </select>
  )
}
