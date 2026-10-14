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

type Texts = Record<UserLocale, (link: string) => Omit<MailMessage, 'to'>>

const CHANGE: Texts = {
  en: (link) => ({
    subject: 'Confirm the new email address of your ChillaDesk account',
    text: [
      'Hello,',
      'to make this the address of your ChillaDesk account, sign in and open the link below. It works for two days.',
      link,
      'If you did not ask for this, ignore this message: nothing changes.',
    ].join('\n\n'),
  }),
  ru: (link) => ({
    subject: 'Подтвердите новый адрес почты для ChillaDesk',
    text: [
      'Здравствуйте!',
      'Чтобы этот адрес стал адресом вашей учётной записи ChillaDesk, войдите и откройте ссылку ниже. Она действует два дня.',
      link,
      'Если вы этого не запрашивали, просто не отвечайте на письмо: ничего не изменится.',
    ].join('\n\n'),
  }),
}

const TAKEN: Texts = {
  en: (link) => ({
    subject: 'This address already has a ChillaDesk account',
    text: [
      'Hello,',
      'someone asked to move another ChillaDesk account to this address, but it already belongs to an account, so nothing was changed. To sign in to the account of this address, open:',
      link,
      'If that was not you, ignore this message.',
    ].join('\n\n'),
  }),
  ru: (link) => ({
    subject: 'С этим адресом уже есть учётная запись ChillaDesk',
    text: [
      'Здравствуйте!',
      'Кто-то попросил перенести на этот адрес другую учётную запись ChillaDesk, но с ним уже связана учётная запись, поэтому ничего не изменилось. Чтобы войти в учётную запись этого адреса, откройте:',
      link,
      'Если это были не вы, просто не отвечайте на письмо.',
    ].join('\n\n'),
  }),
}

const CHANGED: Texts = {
  en: (link) => ({
    subject: 'The email address of your ChillaDesk account was changed',
    text: [
      'Hello,',
      'your ChillaDesk account now uses another email address, and this one no longer receives its emails.',
      'If you did not do this, someone else has your password: tell the administrator of the server. To sign in:',
      link,
    ].join('\n\n'),
  }),
  ru: (link) => ({
    subject: 'Адрес почты вашей учётной записи ChillaDesk изменён',
    text: [
      'Здравствуйте!',
      'Ваша учётная запись ChillaDesk теперь использует другой адрес почты, и на этот адрес письма от неё больше не придут.',
      'Если это сделали не вы, ваш пароль знает кто-то ещё: обратитесь к администратору сервера. Ссылка для входа:',
      link,
    ].join('\n\n'),
  }),
}

export const emailChangeEmail = ({ to, locale, link }: AccountEmail): MailMessage => ({
  to,
  ...CHANGE[locale](link),
})

export const addressTakenEmail = ({ to, locale, link }: AccountEmail): MailMessage => ({
  to,
  ...TAKEN[locale](link),
})

export const emailChangedEmail = ({ to, locale, link }: AccountEmail): MailMessage => ({
  to,
  ...CHANGED[locale](link),
})
