import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">
        <Link to="/" className="text-indigo-600 hover:underline dark:text-indigo-400">
          Back to your projects
        </Link>
      </p>
    </div>
  )
}
