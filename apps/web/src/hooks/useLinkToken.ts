import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

/**
 * The token of a link someone was sent. It is in the fragment (`#token=…`), which the
 * browser keeps to itself, so it never reaches the logs of the server or a proxy.
 *
 * Once read, the fragment is taken out of the address bar and the history, so the token
 * does not stay behind on a shared computer.
 */
export function useLinkToken(): string {
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(
    () => new URLSearchParams(location.hash.replace(/^#/, '')).get('token') ?? '',
  )

  useEffect(() => {
    if (location.hash !== '') {
      void navigate({ pathname: location.pathname, search: location.search }, { replace: true })
    }
  }, [location.hash, location.pathname, location.search, navigate])

  return token
}
