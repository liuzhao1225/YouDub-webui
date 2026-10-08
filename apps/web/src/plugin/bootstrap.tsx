'use client'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JsxRuntime from 'react/jsx-runtime'
import * as JsxDevRuntime from 'react/jsx-dev-runtime'
import * as Cordis from 'cordis'
import * as SDK from './sdk'
import { disposeFiber, ModuleLoader } from './loader'

declare global { var __YOUDUB_PLATFORM__: Readonly<Record<string, unknown>> | undefined }
function publishPlatform() {
  if (globalThis.__YOUDUB_PLATFORM__) return
  Object.defineProperty(globalThis, '__YOUDUB_PLATFORM__', { value: Object.freeze({
    react: React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient,
    'react/jsx-runtime': JsxRuntime, 'react/jsx-dev-runtime': JsxDevRuntime,
    cordis: Cordis, '@youdub/sdk/client': SDK,
  }), writable: false, configurable: false })
}
function PluginRoot({ context }: { context: Cordis.Context }) {
  SDK.useObservable(context.slots)
  const root = context.slots.list('root')
  if (root.length !== 1) throw new Error('Client composition must register exactly one root')
  const Component = root[0].component
  return <SDK.PluginContextProvider context={context}><Component /></SDK.PluginContextProvider>
}
export function PluginBootstrap() {
  const [context, setContext] = React.useState<Cordis.Context | null>(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let stopped = false
    const root = new Cordis.Context()
    const app = root.plugin({ name: 'client-application', async apply(scope: Cordis.Context) {
      publishPlatform()
      let loader!: ModuleLoader
      await SDK.requireActive(scope.plugin({ name: 'client-module-loader', apply(owner: Cordis.Context) { loader = new ModuleLoader(owner) } }), 'client-module-loader')
      const manifest = await loader.manifest()
      await loader.mount(manifest.modules.filter((entry) => entry.access === 'public'), 'public-client')
      await SDK.requireActive(scope.inject(['slots', 'session', 'navigation', 'apiClient'], (view) => {
        if (view.slots.list('root').length !== 1) throw new Error('Client root plugin is missing')
        if (!stopped) setContext(view)
      }), 'client-renderer')
    } })
    void SDK.requireActive(app, 'client-application').catch((failure: Error) => { if (!stopped) setError(failure.message) })
    return () => { stopped = true; void disposeFiber(root, app).catch((failure: Error) => console.error('Client cleanup failed', failure)) }
  }, [])
  if (error) return <main className="mx-auto max-w-xl p-8" role="alert"><h1 className="text-lg font-semibold">应用启动失败</h1><pre className="mt-4 whitespace-pre-wrap text-sm">{error}</pre></main>
  return context ? <PluginRoot context={context} /> : <div className="p-8 text-sm text-muted-foreground" role="status">正在加载…</div>
}
