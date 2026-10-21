import type { Plugin } from 'vite'

/** Serve official plugin source modules in development; the Host still decides access. */
export function clientPluginDevelopment(target: string): Plugin {
  const services = new Set(['slots', 'api', 'navigation', 'session'])
  return {
    name: 'youdub-client-plugin-development',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/api/v2/client-manifest') return next()
        try {
          const upstream = await fetch(new URL(request.url, target), { headers: {
            ...(request.headers.cookie ? { Cookie: request.headers.cookie } : {}),
          } })
          const body = await upstream.text()
          response.statusCode = upstream.status
          response.setHeader('Content-Type', 'application/json')
          response.setHeader('Cache-Control', 'no-store')
          if (!upstream.ok) { response.end(body); return }
          const manifest = JSON.parse(body)
          manifest.modules = manifest.modules.map((entry: { id: string; url: string; css?: string[] }) => {
            if (!entry.url.startsWith('/api/plugins/youdub-client/')) return entry
            const name = entry.id.replace(/^youdub\./, '')
            if (!/^[a-z-]+$/.test(name)) throw new Error(`Invalid official client module: ${entry.id}`)
            return { ...entry, url: `/src/plugin/builtin/${name}.${services.has(name) ? 'ts' : 'tsx'}`, css: [] }
          })
          response.end(JSON.stringify(manifest))
        } catch (error) { next(error) }
      })
    },
  }
}
