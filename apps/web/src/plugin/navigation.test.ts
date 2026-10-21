import { Context, type Fiber } from 'cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { SlotsService } from './builtin/slots'
import { NavigationService } from './builtin/navigation'
import { requireActive } from './sdk'

let fiber: Fiber | undefined

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

async function setup(layout: 'standalone' | 'dialog' = 'standalone') {
  const ctx = new Context()
  let navigation!: NavigationService
  fiber = ctx.plugin((owner) => {
    new SlotsService(owner)
    owner.slots.register('shell.routes', { id: 'settings', path: '/settings', access: 'authenticated', layout, component: () => null })
    owner.slots.register('shell.routes', { id: 'settings-section', path: '/settings/:section', access: 'authenticated', layout, component: () => null })
    navigation = new NavigationService(owner)
  })
  await requireActive(fiber, 'navigation')
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  return { navigation, scroll }
}

it('starts pushed and replaced pages at the top without adding a history entry on replace', async () => {
  const { navigation, scroll } = await setup()
  const paths: string[] = []
  navigation.subscribe(() => paths.push(navigation.getSnapshot()))
  const initialLength = window.history.length

  navigation.push('/settings')
  expect(navigation.getSnapshot()).toBe('/settings')
  expect(window.history.length).toBe(initialLength + 1)
  expect(scroll).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' })

  navigation.replace('/tasks?status=succeeded')
  expect(navigation.getSnapshot()).toBe('/tasks?status=succeeded')
  expect(window.history.length).toBe(initialLength + 1)
  expect(scroll).toHaveBeenCalledTimes(2)
  expect(paths).toEqual(['/settings', '/tasks?status=succeeded'])
})

it('leaves back and forward scrolling to the browser while notifying route subscribers', async () => {
  const { navigation, scroll } = await setup()
  navigation.push('/settings')
  navigation.push('/tasks')
  const changed = vi.fn()
  navigation.subscribe(changed)
  scroll.mockClear()

  window.history.back()
  await vi.waitFor(() => expect(navigation.getSnapshot()).toBe('/settings'))
  expect(changed).toHaveBeenCalledOnce()
  expect(scroll).not.toHaveBeenCalled()

  window.history.forward()
  await vi.waitFor(() => expect(navigation.getSnapshot()).toBe('/tasks'))
  expect(changed).toHaveBeenCalledTimes(2)
  expect(scroll).not.toHaveBeenCalled()
})

it('keeps the current page until an asynchronous unsaved-change decision succeeds', async () => {
  const { navigation } = await setup()
  navigation.push('/workflows/example')
  let decide!: (allowed: boolean) => void
  const remove = navigation.block(() => new Promise<boolean>((resolve) => { decide = resolve }))
  navigation.push('/tasks')
  expect(navigation.getSnapshot()).toBe('/workflows/example')
  decide(false)
  await Promise.resolve()
  expect(navigation.getSnapshot()).toBe('/workflows/example')
  remove()
  await vi.waitFor(() => { navigation.push('/tasks'); expect(navigation.getSnapshot()).toBe('/tasks') })
})

it('restores browser Back when editing continues and permits a later approved Back', async () => {
  const { navigation } = await setup()
  navigation.push('/workflows')
  navigation.push('/workflows/example')
  const block = vi.fn(async () => false)
  const remove = navigation.block(block)
  window.history.back()
  await vi.waitFor(() => expect(block).toHaveBeenCalledWith('/workflows'))
  expect(navigation.getSnapshot()).toBe('/workflows/example')
  remove()
  navigation.block(async () => true)
  window.history.back()
  await vi.waitFor(() => expect(navigation.getSnapshot()).toBe('/workflows'))
})

it('preserves the entry route across settings sections without a second shell', async () => {
  const { navigation } = await setup()
  navigation.push('/tasks/review?tab=translation')
  navigation.push('/settings')
  expect(window.history.state.youdubReturnTo).toBe('/tasks/review?tab=translation')
  navigation.replace('/settings/general')
  navigation.push('/settings/models')
  expect(window.history.state.youdubReturnTo).toBe('/tasks/review?tab=translation')
  navigation.push(window.history.state.youdubReturnTo)
  expect(navigation.getSnapshot()).toBe('/tasks/review?tab=translation')
  expect(window.history.state.youdubReturnTo).toBeUndefined()
})

it('preserves the history index after remounting on reload so Back still checks unsaved changes', async () => {
  const first = await setup()
  first.navigation.push('/settings/models')
  const index = window.history.state.youdubIndex
  await fiber?.dispose()
  const { navigation } = await setup()
  expect(window.history.state.youdubIndex).toBe(index)
  const block = vi.fn(async () => false)
  navigation.block(block)
  window.history.back()
  await vi.waitFor(() => expect(block).toHaveBeenCalledWith('/'))
  expect(navigation.getSnapshot()).toBe('/settings/models')
})

it('opens settings over a dirty page and replaces sections without scrolling or growing history', async () => {
  const { navigation, scroll } = await setup('dialog')
  navigation.push('/workflows/example?node=translate')
  const pageBlock = vi.fn(async () => false)
  navigation.block(pageBlock)
  scroll.mockClear()
  const initialLength = window.history.length

  navigation.push('/settings/general')
  expect(navigation.getSnapshot()).toBe('/settings/general')
  expect(window.history.state.youdubReturnTo).toBe('/workflows/example?node=translate')
  expect(window.history.length).toBe(initialLength + 1)
  navigation.push('/settings/models')
  expect(navigation.getSnapshot()).toBe('/settings/models')
  expect(window.history.length).toBe(initialLength + 1)
  expect(pageBlock).not.toHaveBeenCalled()
  expect(scroll).not.toHaveBeenCalled()

  const changed = vi.fn()
  navigation.subscribe(changed)
  navigation.dismissDialog()
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(navigation.getSnapshot()).toBe('/workflows/example?node=translate')
  expect(pageBlock).not.toHaveBeenCalled()
  expect(scroll).not.toHaveBeenCalled()
})

it('checks only dialog changes when switching sections or dismissing settings', async () => {
  const { navigation } = await setup('dialog')
  navigation.push('/tasks/review')
  navigation.push('/settings/general')
  const pageBlock = vi.fn(async () => false)
  const dialogBlock = vi.fn(async () => false)
  navigation.block(pageBlock)
  navigation.block(dialogBlock, 'dialog')

  navigation.push('/settings/models')
  await vi.waitFor(() => expect(dialogBlock).toHaveBeenCalledWith('/settings/models'))
  expect(navigation.getSnapshot()).toBe('/settings/general')
  expect(pageBlock).not.toHaveBeenCalled()
  await Promise.resolve()

  navigation.dismissDialog()
  await vi.waitFor(() => expect(dialogBlock).toHaveBeenCalledWith('/tasks/review'))
  expect(navigation.getSnapshot()).toBe('/settings/general')
  expect(pageBlock).not.toHaveBeenCalled()

  dialogBlock.mockResolvedValue(true)
  const changed = vi.fn()
  navigation.subscribe(changed)
  navigation.dismissDialog()
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(navigation.getSnapshot()).toBe('/tasks/review')
})

it('checks the dialog and then the background editor before navigating to another page', async () => {
  const { navigation, scroll } = await setup('dialog')
  navigation.push('/workflows/example')
  navigation.push('/settings/models')
  const order: string[] = []
  const removePageBlock = navigation.block(async () => { order.push('page'); return false })
  navigation.block(async () => { order.push('dialog'); return true }, 'dialog')
  scroll.mockClear()
  navigation.push('/tasks')
  await vi.waitFor(() => expect(order).toEqual(['dialog', 'page']))
  expect(navigation.getSnapshot()).toBe('/settings/models')
  expect(scroll).not.toHaveBeenCalled()

  removePageBlock()
  navigation.push('/tasks')
  await vi.waitFor(() => expect(navigation.getSnapshot()).toBe('/tasks'))
  expect(window.history.state.youdubReturnTo).toBeUndefined()
  expect(scroll).toHaveBeenCalledOnce()
})

it('keeps background edits protected through browser Back and Forward around the dialog', async () => {
  const { navigation, scroll } = await setup('dialog')
  navigation.push('/workflows/example')
  navigation.push('/settings/models')
  const pageBlock = vi.fn(async () => false)
  const dialogBlock = vi.fn(async () => true)
  navigation.block(pageBlock)
  navigation.block(dialogBlock, 'dialog')
  const changed = vi.fn()
  navigation.subscribe(changed)
  scroll.mockClear()

  window.history.back()
  await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
  expect(navigation.getSnapshot()).toBe('/workflows/example')
  expect(dialogBlock).toHaveBeenCalledOnce()
  expect(pageBlock).not.toHaveBeenCalled()

  window.history.forward()
  await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
  expect(navigation.getSnapshot()).toBe('/settings/models')
  expect(dialogBlock).toHaveBeenCalledOnce()
  expect(pageBlock).not.toHaveBeenCalled()
  expect(scroll).not.toHaveBeenCalled()

  window.history.go(-2)
  await vi.waitFor(() => expect(pageBlock).toHaveBeenCalledWith('/'))
  expect(navigation.getSnapshot()).toBe('/settings/models')
  expect(changed).toHaveBeenCalledTimes(2)
})

it('dismisses a directly opened dialog by replacing the default background route', async () => {
  window.history.replaceState(null, '', '/settings/models')
  const { navigation, scroll } = await setup('dialog')
  const initialLength = window.history.length
  const pageBlock = vi.fn(async () => false)
  const dialogBlock = vi.fn(async () => false)
  navigation.block(pageBlock)
  navigation.block(dialogBlock, 'dialog')
  navigation.dismissDialog()
  await vi.waitFor(() => expect(dialogBlock).toHaveBeenCalledWith('/'))
  expect(navigation.getSnapshot()).toBe('/settings/models')
  await Promise.resolve()

  dialogBlock.mockResolvedValue(true)
  navigation.dismissDialog()
  await vi.waitFor(() => expect(navigation.getSnapshot()).toBe('/'))
  expect(window.history.length).toBe(initialLength)
  expect(pageBlock).not.toHaveBeenCalled()
  expect(scroll).not.toHaveBeenCalled()
})

it('retains the dialog entry point after a reload and closes Back to that page', async () => {
  const first = await setup('dialog')
  first.navigation.push('/tasks/review')
  first.navigation.push('/settings/general')
  first.navigation.replace('/settings/resources')
  await fiber?.dispose()
  const { navigation, scroll } = await setup('dialog')
  scroll.mockClear()
  const changed = vi.fn()
  navigation.subscribe(changed)
  navigation.block(async () => true, 'dialog')

  navigation.dismissDialog()
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(navigation.getSnapshot()).toBe('/tasks/review')
  expect(scroll).not.toHaveBeenCalled()
})
