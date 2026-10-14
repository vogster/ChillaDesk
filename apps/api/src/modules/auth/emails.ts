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
      'please confirm that this address is yours: open the link below and, if asked, enter your ChillaDesk password. It works for two days.',
      link,
      'If you did not create a ChillaDesk account, ignore this message.',
    ].join('\n\n'),
  }),
  ru: (link) => ({
    subject: 'Подтвердите адрес почты для ChillaDesk',
    text: [
      'Здравствуйте!',
      'Подтвердите, что это ваш адрес: откройте ссылку ниже и, если попросят, введите пароль от ChillaDesk. Она действует два дня.',
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

const EXISTING: Record<UserLocale, (links: ExistingAccountLinks) => Omit<MailMessage, 'to'>> = {
  en: ({ login, reset }) => ({
    subject: 'You already have a ChillaDesk account',
    text: [
      'Hello,',
      'someone tried to sign up for ChillaDesk with this address, but it already has an account. To sign in, open:',
      login,
      'If you have forgotten the password, choose a new one here:',
      reset,
      'If that was not you, ignore this message: nothing has changed.',
    ].join('\n\n'),
  }),
  ru: ({ login, reset }) => ({
    subject: 'У вас уже есть учётная запись ChillaDesk',
    text: [
      'Здравствуйте!',
      'Кто-то пытался зарегистрироваться в ChillaDesk с этим адресом, но учётная запись с ним уже есть. Чтобы войти, откройте:',
      login,
      'Если вы забыли пароль, задайте новый здесь:',
      reset,
      'Если это были не вы, просто не отвечайте на письмо: ничего не изменилось.',
    ].join('\n\n'),
  }),
}

interface ExistingAccountLinks {
  login: string
  reset: string
}

/** Sent instead of a confirmation when someone signs up with an address that has an account. */
export const existingAccountEmail = ({
  to,
  locale,
  publicUrl,
}: {
  to: string
  locale: UserLocale
  publicUrl: string
}): MailMessage => {
  const base = publicUrl.replace(/\/+$/, '')
  return { to, ...EXISTING[locale]({ login: `${base}/login`, reset: `${base}/forgot-password` }) }
}
