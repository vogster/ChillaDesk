import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'

// The default second is tight for flows that type a lot while coverage slows everything down.
configure({ asyncUtilTimeout: 4000 })

// Pages and the Markdown renderer load lazily. Compiling them on first use can take longer
// than a test waits for the page under a full parallel run, so they are loaded up front.
const lazyModules = import.meta.glob(['../pages/**/*.tsx', '!../pages/**/*.test.tsx'])
beforeAll(async () => {
  await Promise.all(Object.values(lazyModules).map((load) => load()))
}, 60_000)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // Editors keep unsaved drafts here; one test's draft must not appear in the next.
  sessionStorage.clear()
  // The chosen interface language is kept here.
  localStorage.clear()
})
