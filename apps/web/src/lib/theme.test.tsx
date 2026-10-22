import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeProvider, restoreTheme, useTheme } from './theme'

function Controls() {
  const { theme, setTheme } = useTheme()
  return <><output>{theme}</output>{(['light', 'dark', 'system'] as const).map(value => <button key={value} onClick={() => setTheme(value)}>{value}</button>)}</>
}
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.classList.remove('dark'); vi.unstubAllGlobals() })
it('defaults to light and restores the explicitly selected theme', () => {
  render(<ThemeProvider><Controls /></ThemeProvider>)
  expect(screen.getByRole('status')).toHaveTextContent('light')
  fireEvent.click(screen.getByRole('button', { name: 'dark' }))
  expect(localStorage.getItem('youdub-theme')).toBe('dark')
  expect(document.documentElement).toHaveClass('dark')
  cleanup()
  restoreTheme()
  render(<ThemeProvider><Controls /></ThemeProvider>)
  expect(screen.getByRole('status')).toHaveTextContent('dark')
})
it('follows system changes only while system is selected', () => {
  const query = new EventTarget() as EventTarget & { matches: boolean }
  query.matches = true
  vi.stubGlobal('matchMedia', () => query)
  render(<ThemeProvider><Controls /></ThemeProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'system' }))
  expect(document.documentElement).toHaveClass('dark')
  act(() => { query.matches = false; query.dispatchEvent(new Event('change')) })
  expect(document.documentElement).not.toHaveClass('dark')
  fireEvent.click(screen.getByRole('button', { name: 'light' }))
  act(() => { query.matches = true; query.dispatchEvent(new Event('change')) })
  expect(document.documentElement).not.toHaveClass('dark')
})
