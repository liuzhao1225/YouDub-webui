/** Framework-only binding between client services and props-based React features. */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode, type ComponentType } from 'react'
import type { Context } from 'cordis'
import type { SlotMap, WorkflowDocument, WorkflowDocumentRecord } from './sdk'
import type { Observable, Request, SessionSnapshot } from './runtime/types'
import { QueryClient, type QueryResult } from './runtime/query'
import { WorkflowResourcesController, type WorkflowResourcesResult } from './runtime/workflow-resources'
import { UpdatesController, type Updates } from './runtime/updates'

export function useObservableSource<T>(source: Observable<T>): T {
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
}
export function bindObservable<T>(source: Observable<T>): () => T {
  return function useSnapshot() { return useObservableSource(source) }
}
export type UseQuery = <T>(path: string, pollMs?: number) => QueryResult<T>
export function createQueryHook(client: QueryClient): UseQuery {
  return function useQuery<T>(path: string, pollMs?: number): QueryResult<T> {
    const source = useMemo(() => client.query<T>(path, pollMs), [path, pollMs])
    return { ...useObservableSource(source), refresh: source.refresh }
  }
}
const UpdateContext = createContext<Updates | null>(null)
export function UpdateProvider({ request, children }: { request: Request; children: ReactNode }) {
  const source = useMemo(() => new UpdatesController(request), [request])
  const snapshot = useObservableSource(source)
  return <UpdateContext.Provider value={{ ...snapshot, check: source.check, setAutomatic: source.setAutomatic }}>{children}</UpdateContext.Provider>
}

export interface ClientBindings {
  request: Request
  navigate(path: string): void
  replace(path: string): void
  href(routeId: string, params?: Record<string, string>): string
  blockNavigation(handler: (path: string) => Promise<boolean>): () => void
  useQuery: UseQuery
  useWorkflowDocuments(): QueryResult<{ items: WorkflowDocumentRecord[] }>
  useSlot<K extends keyof SlotMap>(slot: K): SlotMap[K][]
  usePathname(): string
  useSession(): SessionSnapshot
  useUpdates(): Updates | null
  useWorkflowResources(document: WorkflowDocument): WorkflowResourcesResult
}
export type Bindings<K extends keyof ClientBindings> = Pick<ClientBindings, K>

/** Captures only the named capabilities in the plugin apply closure. Components never receive ctx. */
export function bindComponent<P extends object, K extends keyof ClientBindings>(ctx: Context, keys: readonly K[], Component: ComponentType<P>) {
  const injected: Partial<ClientBindings> = {}
  const has = (key: keyof ClientBindings) => keys.includes(key as K)
  if (has('request') || has('useQuery') || has('useWorkflowDocuments') || has('useWorkflowResources')) {
    const api = ctx.apiClient
    const request: Request = api.request.bind(api)
    if (has('request')) injected.request = request
    if (has('useWorkflowResources')) injected.useWorkflowResources = function useWorkflowResources(document) {
      const key = JSON.stringify(document.nodes.map((node) => [node.type, node.typeVersion, node.provider]))
      // Only provider selection replaces the resource request; ordinary document edits keep its owner.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const source = useMemo(() => new WorkflowResourcesController(request, document, () => window.dispatchEvent(new Event('youdub:resources-ready'))), [key])
      useEffect(() => source.setDocument(document), [source, document])
      const snapshot = useObservableSource(source)
      return { ...snapshot, ready: !snapshot.error && !snapshot.checking && snapshot.result?.status === 'ready', check: source.check, prepare: source.prepare }
    }
    const queries = new QueryClient(request)
    if (has('useQuery')) injected.useQuery = createQueryHook(queries)
    if (has('useWorkflowDocuments')) injected.useWorkflowDocuments = function useWorkflowDocuments() {
      const source = useMemo(() => queries.workflowDocuments(), [])
      return { ...useObservableSource(source), refresh: source.refresh }
    }
  }
  if (has('navigate') || has('replace') || has('href') || has('blockNavigation') || has('usePathname')) {
    const navigation = ctx.navigation
    if (has('navigate')) injected.navigate = (path) => navigation.push(path)
    if (has('replace')) injected.replace = (path) => navigation.replace(path)
    if (has('href')) injected.href = (id, params) => navigation.href(id, params)
    if (has('blockNavigation')) injected.blockNavigation = (handler) => navigation.block?.(handler) ?? (() => {})
    if (has('usePathname')) injected.usePathname = function usePathname() { return useObservableSource(navigation).split('?')[0] }
  }
  if (has('useUpdates')) injected.useUpdates = function useUpdates() { return useContext(UpdateContext) }
  if (has('useSession')) injected.useSession = bindObservable(ctx.session)
  if (has('useSlot')) {
    const slots = ctx.slots
    injected.useSlot = function useSlot<K extends keyof SlotMap>(slot: K) { useObservableSource(slots); return slots.list(slot) }
  }
  return function BoundComponent(props: Omit<P, K>) { return <Component {...props as P} {...injected} /> }
}
