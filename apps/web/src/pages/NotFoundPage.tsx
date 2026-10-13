import { Link } from 'react-router'
import { useT } from '../i18n'

export function NotFoundPage() {
  const t = useT()
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">{t.shell.notFound.title}</h1>
      <p className="mt-2 text-sm text-slate-500">
        <Link to="/" className="text-indigo-600 hover:underline dark:text-indigo-400">
          {t.shell.notFound.back}
        </Link>
      </p>
    </div>
  )
}
