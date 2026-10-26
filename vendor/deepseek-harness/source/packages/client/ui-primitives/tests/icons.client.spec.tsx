// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

const icons = Object.entries(primitives).filter(([name]) => name.startsWith('Icon')) as
  [string, (props: primitives.IconProps) => React.JSX.Element][]

it.each(icons)('%s keeps theme color, accessibility and caller sizing', (_name, Icon) => {
  const { container } = render(<Icon size={20} className="icon-test" />)
  const svg = container.querySelector('svg')!
  expect(svg.getAttribute('aria-hidden')).toBe('true')
  expect(svg.getAttribute('width')).toBe('20')
  expect(svg.getAttribute('height')).toBe('20')
  expect(svg.classList.contains('icon-test')).toBe(true)
  expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
  expect(container.innerHTML).toContain('currentColor')
})

it('preserves regular and medium stroke widths', () => {
  const regular = render(<primitives.IconNewChatOutlineRegular />)
  expect(regular.container.querySelector('svg')?.getAttribute('stroke-width')).toBe('1')
  const medium = render(<primitives.IconNewChatOutlineMedium />)
  expect(medium.container.querySelector('svg')?.getAttribute('stroke-width')).toBe('1.3')
})
