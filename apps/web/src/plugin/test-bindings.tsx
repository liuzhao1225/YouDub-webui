/** Business tests use the Desktop feature runtime with fixture transport and slot content. */
import { type ComponentType, type ReactNode } from 'react'
import { afterEach } from 'vitest'
import { createFeatures, FeatureProvider, useFeatures } from '../../../harness/src/frontend/runtime'
import { NavigationContext } from '../../../harness/src/frontend/sdk'
import type { ClientBindings, Request } from './sdk'

export type TestContext = {
  apiClient: { request: Request }
  navigation?: { push(path: string): void; replace?(path: string): void; block?(handler: (path: string) => Promise<boolean>): () => void }
  slots?: { list?(slot: string): any[]; subscribe?(listener: () => void): () => void; getSnapshot?(): number; register?(slot: string, entry: any): () => void }
  effect?(effect: () => unknown): unknown
}
const hosts = new WeakMap<TestContext, ReturnType<typeof createTestHost>>()
const cleanups = new Set<() => void>()
afterEach(() => { cleanups.forEach(dispose => dispose()); cleanups.clear() })
export function createTestHost(context: TestContext) {
  const disposers: (() => void)[] = []
  const listeners = new Map<string, Set<() => void>>()
  const subscribe = (event: string, callback: () => void) => {
    const set = listeners.get(event) ?? new Set(); listeners.set(event, set); set.add(callback)
    return () => { set.delete(callback) }
  }
  const slots = (name: string) => context.slots?.list?.(name.replace(/^youdub\./, '')) ?? []
  const navigate = (path: string) => context.navigation?.push(path)
  const features = createFeatures({
    effect(effect: () => (() => void) | void) { const dispose = effect(); if (dispose) disposers.push(dispose) },
    remote: { $on: subscribe }, on: subscribe,
    slots: { subscribe: (_name: string, listener: () => void) => context.slots?.subscribe?.(listener) ?? (() => {}),
      getVersion: () => context.slots?.getSnapshot?.() ?? 0,
      entriesOfSlot: (name: string) => slots(name).map(entry => ({ options: entry })) },
  }, navigate, context.navigation?.block ?? (() => () => {}), context.apiClient.request)
  const value = { ...features, renderSlot(name: string, props: object, options: { only: string }) {
    const entry = slots(name).find(entry => entry.id === options.only)
    if (!entry) throw new Error(`Missing fixture slot ${name}: ${options.only}`)
    const Component = entry.component
    return <Component {...props} />
  } }
  const dispose = () => { disposers.splice(0).reverse().forEach(dispose => dispose()) }
  cleanups.add(dispose)
  return { value, dispose, emit: (event: string) => listeners.get(event)?.forEach(listener => listener()), listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0) }
}
export function testHost(context: TestContext) {
  let host = hosts.get(context)
  if (!host) { host = createTestHost(context); hosts.set(context, host) }
  return host
}
export function TestFeatureProvider({ context, children }: { context: TestContext; children: ReactNode }) {
  const { value } = testHost(context)
  return <NavigationContext.Provider value={value.navigate}><FeatureProvider value={value}>{children}</FeatureProvider></NavigationContext.Provider>
}
export function bindTestComponent<P extends object, K extends keyof ClientBindings>(Component: ComponentType<P>, keys: readonly K[]) {
  return function TestComponent(props: Omit<P, K>) {
    const features = useFeatures()
    return <Component {...props as P} {...Object.fromEntries(keys.map(key => [key, features[key]]))} />
  }
}
