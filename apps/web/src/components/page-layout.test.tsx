import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Page, PageHeader, WindowHeaderProvider } from './page-layout'

afterEach(cleanup)

it('keeps live page actions in the window header and metadata with the content', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const save = vi.fn()
  const page = (title: string, disabled = false) => <WindowHeaderProvider value={host}>
    <Page><PageHeader title={title} actions={<button disabled={disabled} onClick={save}>保存</button>}><time>今天</time></PageHeader><p>编辑内容</p></Page>
  </WindowHeaderProvider>
  const view = render(page('工作流'))
  expect(within(host).getByRole('heading', { name: '工作流' })).toBeVisible()
  expect(within(view.container).queryByRole('heading')).not.toBeInTheDocument()
  expect(within(view.container).getByText('今天')).toBeVisible()
  await userEvent.setup().click(within(host).getByRole('button', { name: '保存' }))
  expect(save).toHaveBeenCalledOnce()
  view.rerender(page('已保存工作流', true))
  expect(within(host).getByRole('heading', { name: '已保存工作流' })).toBeVisible()
  expect(within(host).getByRole('button', { name: '保存' })).toBeDisabled()
  view.unmount()
  expect(host).toBeEmptyDOMElement()
  host.remove()
})

it('keeps the regular page header when no window header is provided', () => {
  render(<Page><PageHeader title="资源" actions={<button>重新检测</button>} /></Page>)
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: '资源' }))
})
