// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { HostObservable, KeyedStandardSource } from '@deepseek-ai/dsh-client-ui-slots'
import { keyedObservableHook } from '../src/client/bindings.tsx'

function observable<T>(initial: T): HostObservable<T> & { set(next: T): void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('keyed standard Hooks', () => {
  it('reads the resolver\'s (key, member) source when the second argument is a string', () => {
    const fork = observable(true)
    const whole = observable({ title: 'one' })
    const resolver = vi.fn<KeyedStandardSource>((key, member) =>
      member === undefined ? (key === 'task1' ? whole : undefined) : (key === 'task1' && member === 'task/retry' ? fork : undefined))
    const useAccess = keyedObservableHook(resolver)

    const member = renderHook(() => useAccess('task1', 'task/retry'))
    expect(member.result.current).toBe(true)
    act(() => { fork.set(false) })
    expect(member.result.current).toBe(false)
    expect(resolver).toHaveBeenCalledWith('task1', 'task/retry')

    expect(renderHook(() => useAccess('task1', 'task/missing')).result.current).toBeUndefined()
    expect(renderHook(() => useAccess('task1')).result.current).toEqual({ title: 'one' })
    expect(resolver.mock.calls.some(call => call.length === 1 && call[0] === 'task1')).toBe(true)
  })

  it('keeps the selector, equality, and default-key call forms', () => {
    const whole = observable({ title: 'one', count: 1 })
    const useValue = keyedObservableHook(key => (key === 'k' ? whole : undefined), 'k')
    expect(renderHook(() => useValue('k', (value: unknown) => (value as { title: string }).title)).result.current).toBe('one')
    expect(renderHook(() => useValue((value: unknown) => (value as { count: number }).count)).result.current).toBe(1)
    const equal = vi.fn(() => true)
    renderHook(() => useValue('k', (value: unknown) => value, equal))
    act(() => { whole.set({ title: 'two', count: 2 }) })
    expect(equal).toHaveBeenCalled()
    const noDefault = keyedObservableHook(key => (key === 'k' ? whole : undefined))
    expect(renderHook(() => noDefault((value: unknown) => value)).result.current).toBeUndefined()
  })

  it('reads undefined for every call form while the source family is absent', () => {
    const absent = keyedObservableHook(undefined)
    expect(renderHook(() => absent('task1', 'task/retry')).result.current).toBeUndefined()
    expect(renderHook(() => absent('task1', (value: unknown) => value ?? 'fallback')).result.current).toBe('fallback')
    expect(renderHook(() => absent((value: unknown) => value ?? 'bare')).result.current).toBe('bare')
  })
})
