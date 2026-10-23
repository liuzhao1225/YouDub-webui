import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { Segmented } from './segmented'
import { Switch } from './switch'
import { Progress } from './progress'
import { Disclosure } from './disclosure'
import { NativeSelect } from './native-select'
import { Select, SelectContent, SelectItem, SelectTrigger } from './select'
afterEach(cleanup)

it('switches enabled segments by keyboard and skips a disabled choice', async () => {
  function Example() {
    const [value, setValue] = useState('light')
    return <Segmented id="appearance" ariaLabel="主题" value={value} onChange={setValue} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色', disabled: true }, { value: 'system', label: '跟随系统' }]} />
  }
  const user = userEvent.setup(); render(<Example />)
  await user.tab(); await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: '跟随系统' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: '跟随系统' })).toHaveFocus()
  await user.keyboard('{Home}')
  expect(screen.getByRole('tab', { name: '浅色' })).toHaveFocus()
})

it('keeps the switch accessible state synchronized with the controlled value', async () => {
  function Example() { const [value, setValue] = useState(false); return <Switch aria-label="自动继续" checked={value} onCheckedChange={setValue} /> }
  const user = userEvent.setup(); render(<Example />)
  await user.click(screen.getByRole('switch', { name: '自动继续' }))
  expect(screen.getByRole('switch', { name: '自动继续' })).toHaveAttribute('aria-checked', 'true')
})

it('exposes actual progress and no percentage for an unknown total', () => {
  const view = render(<Progress label="下载" />)
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  view.rerender(<Progress label="下载" value={0.42} />)
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
})

it('opens diagnostic details without losing their content', async () => {
  const user = userEvent.setup(); render(<Disclosure title="任务日志"><p>下载完成</p></Disclosure>)
  await user.click(screen.getByText('任务日志'))
  expect(screen.getByRole('button', { name: '任务日志' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('下载完成')).toBeVisible()
})


it.each(['field', 'compound'])('uses the Harness menu keyboard, disabled and focus contract for %s selection', async kind => {
  function Example() {
    const [value, setValue] = useState('zh')
    if (kind === 'field') return <NativeSelect aria-label="语言" value={value} onChange={event => setValue(event.target.value)}><option value="zh">中文</option><option value="ja" disabled>日本語</option><option value="en">English</option></NativeSelect>
    return <Select value={value} onValueChange={setValue}><SelectTrigger aria-label="语言">{value === 'zh' ? '中文' : 'English'}</SelectTrigger><SelectContent><SelectItem value="zh">中文</SelectItem><SelectItem value="ja" disabled>日本語</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select>
  }
  const user = userEvent.setup(); render(<Example />)
  const trigger = screen.getByRole('button', { name: '语言' })
  await user.tab(); await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: '中文' })).toHaveFocus()
  expect(screen.getByRole('menuitem', { name: '日本語' })).toBeDisabled()
  await user.keyboard('{ArrowDown}{Enter}')
  expect(trigger).toHaveTextContent('English')
  expect(trigger).toHaveFocus()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  await user.keyboard('{ArrowDown}{Escape}')
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveTextContent('English')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})
