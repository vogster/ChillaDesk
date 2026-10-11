import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

describe('App', () => {
  it('shows the API version when the backend is healthy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', version: '0.1.0', database: 'up' })),
    )

    renderApp()

    expect(screen.getByRole('heading', { name: 'ChillaWiki' })).toBeInTheDocument()
    expect(await screen.findByText('API v0.1.0 — ok')).toBeInTheDocument()
  })

  it('shows an error when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    renderApp()

    expect(await screen.findByRole('alert')).toHaveTextContent('API is unreachable')
  })

  it('shows a loading state first', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))

    renderApp()

    expect(screen.getByText('Checking API…')).toBeInTheDocument()
  })
})
