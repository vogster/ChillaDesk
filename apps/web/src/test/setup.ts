import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// The default second is tight for flows that type a lot while coverage slows everything down.
configure({ asyncUtilTimeout: 4000 })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // Editors keep unsaved drafts here; one test's draft must not appear in the next.
  sessionStorage.clear()
  // The chosen interface language is kept here.
  localStorage.clear()
})
