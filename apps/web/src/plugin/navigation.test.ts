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

async function setup() {
  const ctx = new Context()
  let navigation!: NavigationService
  fiber = ctx.plugin((owner) => {
    new SlotsService(owner)
    owner.slots.register('shell.routes', { id: 'settings', path: '/settings', access: 'authenticated', layout: 'standalone', component: () => null })
    owner.slots.register('shell.routes', { id: 'settings-section', path: '/settings/:section', access: 'authenticated', layout: 'standalone', component: () => null })
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
  navigation.push('/settings/connections')
  expect(window.history.state.youdubReturnTo).toBe('/tasks/review?tab=translation')
  navigation.push(window.history.state.youdubReturnTo)
  expect(navigation.getSnapshot()).toBe('/tasks/review?tab=translation')
  expect(window.history.state.youdubReturnTo).toBeUndefined()
})
