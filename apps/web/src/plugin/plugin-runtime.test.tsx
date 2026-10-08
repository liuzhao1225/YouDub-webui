import { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply as slotsPlugin } from './builtin/slots'
import { matchRoute, parseManifest, requireActive, type Session } from './sdk'
import { defaultConfig, schemaProblems } from './builtin/schema-form'
import { disposeFiber, settleModules } from './loader'
import * as sessionPlugin from './builtin/session'

describe('Cordis Client composition', () => {
  it('unloads authenticated modules on an expired logout and keeps the original diagnostic visible', async () => {
    const ctx = new Context()
    const unmount = vi.fn(), clearSession = vi.fn(), replace = vi.fn()
    const expired = Object.assign(new Error('Session expired'), { status: 401 })
    await requireActive(ctx.plugin((owner) => {
      owner.reflect.provide('apiClient', { request: async (path: string) => { if (path.endsWith('logout')) throw expired; return { authenticated: true, csrf_token: 'test-token' } }, setCsrf() {}, clearSession })
      owner.reflect.provide('navigation', { replace })
      owner.reflect.provide('clientModules', { mountAuthenticated: async () => {}, unmountAuthenticated: unmount })
    }), 'session-dependencies')
    const fiber = ctx.plugin(sessionPlugin)
    await requireActive(fiber, 'session')
    let session!: Session
    await requireActive(ctx.inject(['session'], (owner) => { session = owner.session }), 'session-consumer')
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('authenticated'))
    await session.logout()
    expect(session.getSnapshot()).toEqual({ status: 'anonymous', error: 'Session expired' })
    expect(clearSession).toHaveBeenCalledOnce()
    expect(unmount).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/login')
    await disposeFiber(ctx, fiber)
  })
  it('reports a disposer failure even when Cordis disposal resolves', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin((owner) => { owner.effect(() => () => { throw new Error('External cleanup failed') }) })
    await requireActive(fiber, 'failing-cleanup')
    await expect(disposeFiber(ctx, fiber)).rejects.toThrow('External cleanup failed')
  })
  it('settles a simultaneously installed dependency chain before requiring active modules', async () => {
    const ctx = new Context()
    const fibers = [
      { id: 'consumer', fiber: ctx.plugin({ inject: ['slots'], apply(owner) { owner.effect(() => owner.slots.register('shell.navigation', { id: 'sample', routeId: 'sample', label: 'Sample' })) } }) },
      { id: 'slots', fiber: ctx.plugin(slotsPlugin) },
    ]
    await settleModules(fibers)
    expect(fibers.map(({ fiber }) => fiber.state)).toEqual([2, 2])
    await Promise.all(fibers.map(({ fiber }) => fiber.dispose()))
  })

  it('releases registered routes with their owning plugin and rejects a conflicting route', async () => {
    const ctx = new Context()
    const application = ctx.plugin(async (scope) => {
      await requireActive(scope.plugin(slotsPlugin), 'slots')
      const page = scope.plugin({ name: 'external-page', inject: ['slots'], apply(owner) {
        owner.effect(() => owner.slots.register('shell.routes', { id: 'sample', path: '/sample/:id', access: 'authenticated', component: () => null }))
      } })
      await requireActive(page, 'external-page')
      await requireActive(scope.inject(['slots'], async (consumer) => {
        expect(consumer.slots.list('shell.routes').map((entry) => entry.id)).toEqual(['sample'])
        expect(() => consumer.slots.register('shell.routes', { id: 'conflict', path: '/sample/:other', access: 'authenticated', component: () => null })).toThrow('Conflicting')
        await page.dispose()
        expect(consumer.slots.list('shell.routes')).toEqual([])
      }), 'slot-consumer')
    })
    await requireActive(application, 'application')
    await application.dispose()
  })

  it('matches installed routes without adding Next file routes', () => {
    expect(matchRoute('/extensions/task%201', '/extensions/:id')).toEqual({ id: 'task 1' })
    expect(matchRoute('/extensions/task/1', '/extensions/:id')).toBeNull()
    expect(matchRoute('/extensions/%zz', '/extensions/:id')).toBeNull()
  })

  it('rejects incompatible manifests and remote executable modules', () => {
    const manifest = { version: 1, sdkVersion: '1.0.0', platformVersion: '1', modules: [{ id: 'example', version: '1.0.0', access: 'authenticated', url: '/api/plugins/example/1.0.0/client.js' }] }
    expect(parseManifest(manifest)).toEqual(manifest)
    expect(() => parseManifest({ ...manifest, sdkVersion: '2.0.0' })).toThrow('version')
    expect(() => parseManifest({ ...manifest, modules: [{ ...manifest.modules[0], url: '//remote.example/plugin.js' }] })).toThrow('Invalid')
    expect(() => parseManifest({ ...manifest, modules: [...manifest.modules, ...manifest.modules] })).toThrow('Invalid')
  })

  it('preserves nested defaults and requires a custom editor for unsupported schema', () => {
    expect(defaultConfig({ type: 'object', properties: { enabled: { type: 'boolean', default: true }, options: { type: 'object', properties: { limit: { type: 'integer', default: 3 } } } } })).toEqual({ enabled: true, options: { limit: 3 } })
    expect(schemaProblems({ type: 'object', properties: { rows: { type: 'array', items: { type: 'string' } } } })).toEqual(['rows'])
  })
})

it('prefers an installed static route over an earlier parameter route', async () => {
  const { resolveRoute } = await import('./builtin/shell')
  const component = () => null
  const routes = [
    { id: 'task-detail', path: '/tasks/:id', access: 'authenticated' as const, component },
    { id: 'external-help', path: '/tasks/help', access: 'authenticated' as const, component },
  ]
  expect(resolveRoute(routes, '/tasks/help', true)?.route.id).toBe('external-help')
  expect(resolveRoute(routes, '/tasks/task-1', true)?.params).toEqual({ id: 'task-1' })
  expect(resolveRoute(routes, '/tasks/help', false)).toBeUndefined()
})
