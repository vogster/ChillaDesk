import type { UserLocale } from '@chilladesk/shared'
import type { MailMessage } from '../notifications/mailer'

interface AccountEmail {
  to: string
  locale: UserLocale
  /** The page to open; the token rides in the fragment, which browsers do not send on. */
  link: string
}

// None of these texts contains anything a user wrote, their name included: the address may
// belong to someone else, and the server must not carry a stranger's words to them.
const VERIFY: Record<UserLocale, (link: string) => Omit<MailMessage, 'to'>> = {
  en: (link) => ({
    subject: 'Confirm your email address for ChillaDesk',
    text: [
      'Hello,',
      'please confirm that this address is yours: sign in to ChillaDesk and open the link below. It works for two days.',
      link,
      'If you did not create a ChillaDesk account, ignore this message.',
    ].join('\n\n'),
  }),
  ru: (link) => ({
    subject: 'Подтвердите адрес почты для ChillaDesk',
    text: [
      'Здравствуйте!',
      'Подтвердите, что это ваш адрес: войдите в ChillaDesk и откройте ссылку ниже. Она действует два дня.',
      link,
      'Если вы не создавали учётную запись в ChillaDesk, просто не отвечайте на это письмо.',
    ].join('\n\n'),
  }),
}

const RESET: Record<UserLocale, (link: string) => Omit<MailMessage, 'to'>> = {
  en: (link) => ({
    subject: 'Reset your ChillaDesk password',
    text: [
      'Hello,',
      'someone asked to reset the password of your ChillaDesk account. To choose a new one, open the link below. It works for one hour and only once.',
      link,
      'If that was not you, ignore this message: your password stays as it is.',
    ].join('\n\n'),
  }),
  ru: (link) => ({
    subject: 'Сброс пароля ChillaDesk',
    text: [
      'Здравствуйте!',
      'Кто-то запросил сброс пароля вашей учётной записи ChillaDesk. Чтобы задать новый пароль, откройте ссылку ниже. Она действует один час и срабатывает один раз.',
      link,
      'Если это были не вы, просто не отвечайте на письмо: пароль останется прежним.',
    ].join('\n\n'),
  }),
}

export const verificationEmail = ({ to, locale, link }: AccountEmail): MailMessage => ({
  to,
  ...VERIFY[locale](link),
})

export const passwordResetEmail = ({ to, locale, link }: AccountEmail): MailMessage => ({
  to,
  ...RESET[locale](link),
})
