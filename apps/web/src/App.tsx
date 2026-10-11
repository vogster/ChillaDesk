import { useQuery } from '@tanstack/react-query'
import { fetchHealth } from './api/health'

function ApiStatus() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth })

  if (health.isPending) return <p>Checking API…</p>
  if (health.isError) return <p role="alert">API is unreachable</p>
  return (
    <p>
      API v{health.data.version} — {health.data.status}
    </p>
  )
}

export function App() {
  return (
    <main>
      <h1>ChillaWiki</h1>
      <ApiStatus />
    </main>
  )
}
