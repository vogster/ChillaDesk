import type { User } from '@chilladesk/shared'
import type { FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useLogout } from '../auth/useAuth'
import { useLiveUpdates } from '../hooks/useLiveUpdates'
import { LanguageSwitcher, useT } from '../i18n'
import { NotificationBell } from '../pages/notifications/NotificationBell'
import { Button } from './ui'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm hover:underline ${
    isActive
      ? 'font-medium text-slate-900 dark:text-slate-100'
      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
  }`

function SearchBox() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  // On the results page the box shows what was searched for; elsewhere it starts empty.
  const current = location.pathname === '/search' ? (searchParams.get('q') ?? '') : ''

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const q = String(new FormData(event.currentTarget).get('q') ?? '').trim()
    if (q) navigate(`/search?${new URLSearchParams({ q })}`)
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="min-w-40 flex-1 sm:max-w-xs">
      <label htmlFor="global-search" className="sr-only">
        {t.shell.nav.search}
      </label>
      <input
        // Remount when the searched text changes, so the box follows the address bar.
        key={current}
        id="global-search"
        name="q"
        type="search"
        defaultValue={current}
        placeholder={t.shell.nav.search}
        className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-950"
      />
    </form>
  )
}

export function AppLayout({ user }: { user: User }) {
  const t = useT()
  const logout = useLogout()
  useLiveUpdates()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            ChillaDesk
          </Link>
          <nav aria-label={t.shell.nav.main} className="flex items-center gap-4">
            <NavLink to="/" end className={navLinkClass}>
              {t.shell.nav.projects}
            </NavLink>
            <NavLink to="/my-tasks" className={navLinkClass}>
              {t.shell.nav.myTasks}
            </NavLink>
          </nav>
          <SearchBox />
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            <NavLink to="/tokens" className={navLinkClass}>
              {t.shell.nav.tokens}
            </NavLink>
            <LanguageSwitcher />
            <NavLink
              to="/profile"
              aria-label={t.account.profile.link(user.name)}
              className={(state) => `hidden sm:inline ${navLinkClass(state)}`}
            >
              {user.name}
            </NavLink>
            <Button variant="secondary" onClick={handleLogout} disabled={logout.isPending}>
              {t.shell.nav.logOut}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
