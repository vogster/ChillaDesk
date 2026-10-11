import type { User } from '@chillawiki/shared'
import { Link, Outlet, useNavigate } from 'react-router'
import { useLogout } from '../auth/useAuth'
import { Button } from './ui'

export function AppLayout({ user }: { user: User }) {
  const logout = useLogout()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            ChillaWiki
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline dark:text-slate-400">
              {user.name}
            </span>
            <Button variant="secondary" onClick={handleLogout} disabled={logout.isPending}>
              Log out
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
