// @vitest-environment jsdom
/** The shared checkbox keeps native label activation and controlled state. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Checkbox } from '../src/Checkbox.tsx'

afterEach(cleanup)

it('requests a checked state through its visible label and follows the owner', () => {
  const onChange = vi.fn()
  const { rerender } = render(<Checkbox label="Images" checked={false} onChange={onChange} />)
  fireEvent.click(screen.getByText('Images'))
  expect(onChange).toHaveBeenLastCalledWith(true)
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Images' }).checked).toBe(false)
  rerender(<Checkbox label="Images" checked onChange={onChange} />)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(onChange).toHaveBeenLastCalledWith(false)
})

it('refuses label activation while disabled', () => {
  const onChange = vi.fn()
  render(<Checkbox label="Images" checked disabled onChange={onChange} />)
  fireEvent.click(screen.getByText('Images'))
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
})
