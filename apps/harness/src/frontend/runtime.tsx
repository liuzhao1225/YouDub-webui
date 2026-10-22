import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { QueryClient } from '../../../web/src/plugin/runtime/query'
import { WorkflowResourceChecks, changesResources, resourceKey } from '../../../web/src/plugin/runtime/workflow-resources'
import { responseBody } from '../../../web/src/runtime/http'
import { StudioDraftStore } from '../../../web/src/runtime/studio-draft'
const Features = createContext<any>(null)
export const FeatureProvider = Features.Provider
export function useFeatures() { const value = useContext(Features); if (!value) throw new Error('Harness feature bindings are unavailable'); return value }
export const domainSlots = ['config.editors','task.detail.panels','task.detail.actions','workflow.node.editors','workflow.node.details','settings.sections']
export function createFeatures(ctx:any, navigate:(path:string) => void, blockNavigation:any) {
  const mutations = new Set<() => void>(), draftStore = new StudioDraftStore()
  const resources = new WorkflowResourceChecks(request, () => window.dispatchEvent(new Event('youdub:resources-ready')))
  const invalidateConfiguration = () => { resources.invalidate(); mutations.forEach(listener => listener()) }
  async function request<T>(path:string, init:RequestInit = {}):Promise<T> {
    if (!path.startsWith('/api/')) throw new Error(`Unsupported YouDub API path: ${path}`)
    const method = (init.method ?? 'GET').toUpperCase()
    const multipart = init.body instanceof FormData
    const response = await fetch(multipart ? '/api/youdub/upload' : '/api/youdub/v2', {
      method:'POST', signal:init.signal, credentials:'include',
      headers:multipart ? undefined : { 'content-type':'application/json' },
      body:multipart ? init.body : JSON.stringify({ method, path, ...(init.body ? { body:typeof init.body === 'string' ? JSON.parse(init.body) : init.body } : {}) }),
    })
    const result = await responseBody<T>(response)
    if (!['GET','HEAD'].includes(method)) {
      if (changesResources(path, method, init.body)) invalidateConfiguration()
    }
    return result
  }
  const queries = new QueryClient(request)
  function useQuery(path:string, pollMs?:number, shouldPoll?:any) {
    const source = useMemo(() => queries.query(path,pollMs,shouldPoll),[path,pollMs,shouldPoll])
    useEffect(() => { if (!['/api/v2/catalog','/api/v2/node-types'].includes(path)) return; mutations.add(source.refresh); return () => { mutations.delete(source.refresh) } },[path,source])
    return { ...useSyncExternalStore(source.subscribe, source.getSnapshot), refresh:source.refresh }
  }
  function useWorkflowDocuments() {
    const source = useMemo(() => queries.workflowDocuments(),[])
    useEffect(() => { mutations.add(source.refresh); return () => { mutations.delete(source.refresh) } },[source])
    return { ...useSyncExternalStore(source.subscribe, source.getSnapshot), refresh:source.refresh }
  }
  function useWorkflowResources(document:any) {
    const key = resourceKey(document), source = useMemo(() => resources.get(document),[key])
    useEffect(() => source.setDocument(document),[source,document])
    const state = useSyncExternalStore(source.subscribe,source.getSnapshot)
    return { ...state, ready:!state.error && !state.checking && state.result?.status === 'ready', check:source.check, prepare:source.prepare, action:source.action }
  }
  function useSlot(slot:string) {
    const { renderSlot, ...bindings } = useFeatures(), key = `youdub.${slot}`
    const version = useSyncExternalStore((listener) => ctx.slots.subscribe(key,listener),() => ctx.slots.getVersion(key))
    return useMemo(() => ctx.slots.entriesOfSlot(key).map((entry:any) => ({
      id:entry.options.id, order:entry.options.order, label:entry.options.label,
      component:(props:any) => renderSlot(key,{...bindings,...props},{ only:entry.options.id }),
    })),[key,version,renderSlot])
  }
  ctx.effect(() => () => { resources.clear(); draftStore.reset(); mutations.clear() })
  ctx.effect(() => {
    const disposers = ['llm/adapters-updated','settings/document-updated','credentials/record-updated','credentials/reference-updated'].map(event => ctx.remote.$on(event, invalidateConfiguration))
    disposers.push(ctx.on('connection/reset', invalidateConfiguration))
    return () => disposers.forEach(dispose => dispose())
  })
  ctx.effect(() => { const unload = (event:BeforeUnloadEvent) => { if (Object.keys(draftStore.getSnapshot().submissions).length) { event.preventDefault(); event.returnValue = '' } }; window.addEventListener('beforeunload',unload); return () => window.removeEventListener('beforeunload',unload) })
  return { request, navigate, replace:navigate, blockNavigation, useQuery, useWorkflowDocuments, useWorkflowResources, useSlot, draftStore, submissionStore:draftStore }
}
