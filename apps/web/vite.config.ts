import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { IMPORT_MAP } from './src/plugin/platform'
import { clientPluginDevelopment } from './scripts/dev-plugins'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'YOUDUB_')
  const target = process.env.YOUDUB_API_URL || environment.YOUDUB_API_URL || 'http://127.0.0.1:8000'
  return {
    plugins: [react(), clientPluginDevelopment(target), {
      name: 'youdub-platform-import-map',
      transformIndexHtml: { order: 'pre', handler: () => [{
        tag: 'script', attrs: { type: 'importmap' }, children: JSON.stringify(IMPORT_MAP), injectTo: 'head-prepend',
      }] },
    }],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { host: '127.0.0.1', port: 3000, strictPort: true, proxy: { '/api': { target } } },
    preview: { host: '127.0.0.1', port: 3000, strictPort: true, proxy: { '/api': { target } } },
    build: { target: 'es2022', sourcemap: true },
  }
})
