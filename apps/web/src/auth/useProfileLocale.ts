import type { User } from '@chilladesk/shared'
import { useEffect } from 'react'
import { useLocale } from '../i18n'
import { hasStoredLocale } from '../i18n/messages'
import { useUpdateProfile } from './useAuth'

/**
 * Keeps the language of the interface and the one in the profile the same.
 *
 * On a device where no language was ever picked, the profile decides: someone who uses
 * Russian at work gets Russian on a new phone too. Everywhere else the device decides and
 * the profile follows, so the server knows which language to write emails and name the
 * columns of new projects in.
 */
export function useProfileLocale(user: User | null | undefined): void {
  const [locale, setLocale] = useLocale()
  const { mutate } = useUpdateProfile()
  const userId = user?.id
  const profileLocale = user?.locale

  useEffect(() => {
    if (!userId || profileLocale === locale) return
    if (profileLocale && !hasStoredLocale()) setLocale(profileLocale)
    else mutate({ locale })
  }, [userId, profileLocale, locale, setLocale, mutate])
}
