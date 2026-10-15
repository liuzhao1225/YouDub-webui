import { Context, type Fiber } from 'cordis'
import { afterEach, expect, it, vi } from 'vitest'
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
  fiber = ctx.plugin((owner) => { navigation = new NavigationService(owner) })
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
