import type { ReactNode } from 'react'
import { Card } from '../components/ui'
import { LanguageSwitcher } from '../i18n'

interface AuthShellProps {
  title: string
  children: ReactNode
  footer: ReactNode
}

/** Centered card shared by the login and registration pages. */
export function AuthShell({ title, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-2xl font-semibold tracking-tight">ChillaDesk</p>
        <Card>
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          {children}
        </Card>
        <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">{footer}</p>
        <div className="mt-6 flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}

export const authLinkClass = 'font-medium text-indigo-600 hover:underline dark:text-indigo-400'
