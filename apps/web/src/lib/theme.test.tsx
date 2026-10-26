import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '../../../harness/src/frontend/theme-context'

function Controls() {
  const { theme, setTheme } = useTheme()
  return <><output>{theme}</output>{(['light', 'dark', 'system'] as const).map(value => <button key={value} onClick={() => setTheme(value)}>{value}</button>)}</>
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('reads the current service preference and sends selections back without local persistence', () => {
  const source = { getSnapshot: vi.fn(() => ({ preference: 'dark' })), subscribe: vi.fn(() => () => {}), setTheme: vi.fn() }
  const snapshot = { preference: 'dark' }; source.getSnapshot.mockReturnValue(snapshot)
  const save = vi.spyOn(Storage.prototype, 'setItem')
  render(<ThemeProvider source={source}><Controls /></ThemeProvider>)
  expect(screen.getByRole('status')).toHaveTextContent('dark')
  for (const preference of ['light', 'system', 'dark']) {
    fireEvent.click(screen.getByRole('button', { name: preference }))
    expect(source.setTheme).toHaveBeenLastCalledWith(preference)
  }
  expect(screen.getByRole('status')).toHaveTextContent('dark')
  expect(save).not.toHaveBeenCalled()
})
it('adopts service changes including system preference and releases its subscription on unmount', () => {
  let notify!: () => void
  const unsubscribe = vi.fn()
  const source = { getSnapshot: vi.fn().mockReturnValue({ preference: 'light' }), setTheme: vi.fn(),
    subscribe: vi.fn((listener: () => void) => { notify = listener; return unsubscribe }) }
  const { unmount } = render(<ThemeProvider source={source}><Controls /></ThemeProvider>)
  expect(screen.getByRole('status')).toHaveTextContent('light')
  for (const preference of ['system', 'dark', 'light']) {
    source.getSnapshot.mockReturnValue({ preference })
    act(() => notify())
    expect(screen.getByRole('status')).toHaveTextContent(preference)
  }
  expect(source.setTheme).not.toHaveBeenCalled()
  unmount()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})
