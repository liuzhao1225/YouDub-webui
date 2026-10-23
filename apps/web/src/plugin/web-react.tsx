/** Framework-only binding between client services and props-based React features. */
import { useEffect, useMemo, type ComponentType } from 'react'
import type { Context } from 'cordis'
import type { SlotMap, WorkflowDocument } from './sdk'
import type { Observable, Request, SessionSnapshot } from './runtime/types'
import { QueryClient, type QueryResult, type WorkflowDocuments } from './runtime/query'
import { WorkflowResourceChecks, changesResources, resourceKey, type WorkflowResourcesResult } from './runtime/workflow-resources'

import { useObservableSource } from './view-hooks'
export { useObservableSource, useActiveView, usePendingUnload, protectPendingSubmissions } from './view-hooks'
export function bindObservable<T>(source: Observable<T>): () => T {
  return function useSnapshot() { return useObservableSource(source) }
}
export type UseQuery = <T>(path: string, pollMs?: number, shouldPoll?: (value: T) => boolean) => QueryResult<T>
export function createQueryHook(client: QueryClient, subscribeChanges?: (refresh: () => void) => () => void): UseQuery {
  return function useQuery<T>(path: string, pollMs?: number, shouldPoll?: (value: T) => boolean): QueryResult<T> {
    const source = useMemo(() => client.query<T>(path, pollMs, shouldPoll), [path, pollMs, shouldPoll])
    useEffect(() => {
      if (['/api/v2/catalog', '/api/v2/node-types'].includes(path)) return subscribeChanges?.(source.refresh)
    }, [path, source])
    return { ...useObservableSource(source), refresh: source.refresh }
  }
}
export interface ClientBindings {
  request: Request
  navigate(path: string): void
  replace(path: string): void
  dismissDialog(): void
  href(routeId: string, params?: Record<string, string>): string
  blockNavigation(handler: (path: string) => Promise<boolean>, scope?: 'page' | 'dialog'): () => void
  useQuery: UseQuery
  useWorkflowDocuments(): QueryResult<WorkflowDocuments>
  useSlot<K extends keyof SlotMap>(slot: K): SlotMap[K][]
  usePathname(): string
  useSession(): SessionSnapshot
  useWorkflowResources(document: WorkflowDocument): WorkflowResourcesResult
}
export type Bindings<K extends keyof ClientBindings> = Pick<ClientBindings, K>
const resourceChecks = new WeakMap<object, { cache: WorkflowResourceChecks; owners: number }>()

/** Captures only the named capabilities in the plugin apply closure. Components never receive ctx. */
export function bindComponent<P extends object, K extends keyof ClientBindings>(ctx: Context, keys: readonly K[], Component: ComponentType<P>) {
  const injected: Partial<ClientBindings> = {}
  const has = (key: keyof ClientBindings) => keys.includes(key as K)
  if (has('request') || has('useQuery') || has('useWorkflowDocuments') || has('useWorkflowResources')) {
    const api = ctx.apiClient
    const request: Request = api.request.bind(api)
    if (has('request')) injected.request = request
    if (has('useWorkflowResources')) {
      let entry = resourceChecks.get(api)
      if (!entry) { entry = { cache: new WorkflowResourceChecks(request, () => window.dispatchEvent(new Event('youdub:resources-ready'))), owners: 0 }; resourceChecks.set(api, entry) }
      const owner = entry
      ctx.effect(() => { owner.owners++; return () => { if (--owner.owners === 0) { owner.cache.clear(); resourceChecks.delete(api) } } })
      ctx.on?.('client/mutated', (path, method, body) => { if (changesResources(path, method, body)) owner.cache.invalidate() })
      ctx.on?.('client/session-cleared', () => owner.cache.clear())
      injected.useWorkflowResources = function useWorkflowResources(document) {
        const key = resourceKey(document)
        // Config and canvas edits do not replace the dependency check.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const source = useMemo(() => owner.cache.get(document), [key])
        useEffect(() => source.setDocument(document), [source, document])
        const snapshot = useObservableSource(source)
        return { ...snapshot, ready: !snapshot.error && !snapshot.checking && snapshot.result?.status === 'ready', check: source.check, prepare: source.prepare, action: source.action }
      }
    }
    const queries = new QueryClient(request)
    const subscribeChanges = (refresh: () => void) => {
      const dispose = ctx.on?.('client/mutated', (path, method, body) => { if (changesResources(path, method, body)) refresh() })
      return () => { dispose?.() }
    }
    if (has('useQuery')) injected.useQuery = createQueryHook(queries, subscribeChanges)
    if (has('useWorkflowDocuments')) injected.useWorkflowDocuments = function useWorkflowDocuments() {
      const source = useMemo(() => queries.workflowDocuments(), [])
      useEffect(() => subscribeChanges(source.refresh), [source])
      return { ...useObservableSource(source), refresh: source.refresh }
    }
  }
  if (has('navigate') || has('replace') || has('dismissDialog') || has('href') || has('blockNavigation') || has('usePathname')) {
    const navigation = ctx.navigation
    if (has('navigate')) injected.navigate = (path) => navigation.push(path)
    if (has('replace')) injected.replace = (path) => navigation.replace(path)
    if (has('dismissDialog')) injected.dismissDialog = () => navigation.dismissDialog()
    if (has('href')) injected.href = (id, params) => navigation.href(id, params)
    if (has('blockNavigation')) injected.blockNavigation = (handler, scope) => navigation.block?.(handler, scope) ?? (() => {})
    if (has('usePathname')) injected.usePathname = function usePathname() { return useObservableSource(navigation).split('?')[0] }
  }
  if (has('useSession')) injected.useSession = bindObservable(ctx.session)
  if (has('useSlot')) {
    const slots = ctx.slots
    injected.useSlot = function useSlot<K extends keyof SlotMap>(slot: K) { useObservableSource(slots); return slots.list(slot) }
  }
  return function BoundComponent(props: Omit<P, K>) { return <Component {...props as P} {...injected} /> }
}
