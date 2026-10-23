import "@testing-library/jest-dom/vitest"

import { beforeEach, vi } from 'vitest'

// jsdom has no layout observer. Geometry and viewport fitting are checked in the real client.
beforeEach(() => vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
}))
