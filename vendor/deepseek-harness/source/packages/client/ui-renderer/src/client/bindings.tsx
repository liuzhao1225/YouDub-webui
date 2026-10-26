/** Internal React bindings for renderer hosts and root standard sources. */
import { createContext, useContext, type ReactNode } from 'react'
import type {
  HostObservable,
  KeyedStandardSource,
  SlotRendererHost,
  SnapshotSelectorHook,
  StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from './bind.ts'
import { SlotAssemblyError } from './errors.ts'

/** In-package renderer host context. */
export const HostContext = createContext<SlotRendererHost | null>(null)

/**
 * Read the installed renderer host.
 * @returns the host API.
 */
export function useHost(): SlotRendererHost {
  const host = useContext(HostContext)
  if (host === null) throw new SlotAssemblyError('slot machinery rendered outside the installed renderer tree')
  return host
}

const RootBindingContext = createContext<StandardSourceBinding | null>(null)

/**
 * Read the root standard-source binding.
 * @returns the current root binding.
 */
export function useRootBinding(): StandardSourceBinding {
  const binding = useContext(RootBindingContext)
  if (binding === null) throw new SlotAssemblyError('slot rendered outside the root standard-source provider')
  return binding
}

/**
 * Bind one observable source to an identity-stable selector Hook.
 * @param source - observable source.
 * @returns cached selector Hook.
 */
export function observableHook<T>(source: HostObservable<T>): SnapshotSelectorHook<T> {
  let hook = hookCache.get(source)
  if (hook === undefined) {
    hook = bindSnapshotSelector(source)
    hookCache.set(source, hook)
  }
  return hook as SnapshotSelectorHook<T>
}

const hookCache = new WeakMap<object, unknown>()
const absentSource: HostObservable<undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/**
 * Erased open-key selector Hook synthesized from one keyed source family.
 * A string second argument names a member: the Hook reads the source the
 * resolver returns for `(key, member)` without a selector.
 */
export type KeyedSnapshotHook = (
  keyOrSelector: string | ((value: unknown) => unknown),
  memberOrSelectorOrEqual?: string | ((value: unknown) => unknown) | ((left: unknown, right: unknown) => boolean),
  equal?: (left: unknown, right: unknown) => boolean,
) => unknown

interface KeyedHookCall {
  readonly key: string | undefined
  readonly member: string | undefined
  readonly selector: ((value: unknown) => unknown) | undefined
  readonly equal: ((left: unknown, right: unknown) => boolean) | undefined
}

/** Read the `(key, member)`, `(key, selector?, equal?)`, or `(selector, equal?)` call forms. */
function keyedHookCall(
  defaultKey: string | undefined,
  keyOrSelector: Parameters<KeyedSnapshotHook>[0],
  second: Parameters<KeyedSnapshotHook>[1],
  equal: Parameters<KeyedSnapshotHook>[2],
): KeyedHookCall {
  if (typeof keyOrSelector !== 'string') {
    return {
      key: defaultKey,
      member: undefined,
      selector: keyOrSelector,
      equal: second as ((left: unknown, right: unknown) => boolean) | undefined,
    }
  }
  if (typeof second === 'string') return { key: keyOrSelector, member: second, selector: undefined, equal: undefined }
  return { key: keyOrSelector, member: undefined, selector: second as ((value: unknown) => unknown) | undefined, equal }
}

/**
 * Bind an open-key source family.
 * @param source - keyed resolver, or absence for an optional scope.
 * @returns cached keyed selector Hook.
 */
export function keyedObservableHook(
  source: KeyedStandardSource | undefined,
  defaultKey?: string,
): KeyedSnapshotHook {
  if (source === undefined) return absentKeyedHook
  let hooks = keyedHookCache.get(source)
  if (hooks === undefined) {
    hooks = new Map()
    keyedHookCache.set(source, hooks)
  }
  const cacheKey = defaultKey ?? NO_DEFAULT_KEY
  let hook = hooks.get(cacheKey)
  if (hook === undefined) {
    hook = (keyOrSelector, second, equal) => {
      const call = keyedHookCall(defaultKey, keyOrSelector, second, equal)
      const resolved = call.key === undefined
        ? undefined
        : call.member === undefined ? source(call.key) : source(call.key, call.member)
      const useValue = observableHook(resolved ?? absentSource)
      return useValue(call.selector ?? identity, call.equal)
    }
    hooks.set(cacheKey, hook)
  }
  return hook
}

const NO_DEFAULT_KEY = Symbol('no default key')
const keyedHookCache = new WeakMap<KeyedStandardSource, Map<string | symbol, KeyedSnapshotHook>>()
const identity = (value: unknown): unknown => value
const absentKeyedHook: KeyedSnapshotHook = (keyOrSelector, second, equal) => {
  const call = keyedHookCall(undefined, keyOrSelector, second, equal)
  return observableHook(absentSource)(call.selector ?? identity, call.equal)
}

/** Subscribe the tree to the atomically assembled root standard-source roster. */
export function RootStandardProvider({ children }: { children: ReactNode }) {
  const host = useHost()
  const binding = observableHook(host.root)(value => value)
  return <RootBindingContext.Provider value={binding}>{children}</RootBindingContext.Provider>
}
