import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'package.json'))
const output = resolve(root, 'plugin-dist')
const entries = ['slots', 'api', 'navigation', 'session', 'shell', 'login', 'studio', 'library', 'settings', 'localize-editor']
const publicModules = new Set(['slots', 'api', 'navigation', 'session', 'shell', 'login'])
const shared = { react: 'react', 'react-dom': 'react-dom', 'react-dom/client': 'react-dom-client', 'react/jsx-runtime': 'jsx-runtime', 'react/jsx-dev-runtime': 'jsx-dev-runtime', cordis: 'cordis', '@youdub/sdk/client': 'sdk' }
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const result = await build({
  entryPoints: Object.fromEntries(entries.map((name) => [name, resolve(root, `src/plugin/builtin/${name}.${['slots', 'api', 'navigation', 'session'].includes(name) ? 'ts' : 'tsx'}`)])),
  outdir: output, bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
  jsx: 'automatic', minify: false, sourcemap: true, metafile: true, entryNames: '[name]-[hash]', chunkNames: 'chunks/[name]-[hash]',
  external: ['cordis', '@youdub/sdk/client'], define: { 'process.env.NODE_ENV': '"production"' },
  tsconfig: resolve(root, 'tsconfig.json'),
  plugins: [{ name: 'public-sdk-boundary', setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)sdk$/ }, (args) => args.path === '../sdk' || args.path === './sdk' ? { path: '@youdub/sdk/client', external: true } : undefined)
    // CJS dependencies must receive the same React namespace through an ESM
    // shim; leaving require('react') external creates a browser runtime error.
    builder.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, (args) => {
      if (!(args.path in shared)) throw new Error(`Unsupported platform import: ${args.path}`)
      return args.namespace === 'platform-shim' ? { path: args.path, external: true } : { path: args.path, namespace: 'platform-shim' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'platform-shim' }, (args) => ({ contents: `import * as shared from ${JSON.stringify(args.path)}; export * from ${JSON.stringify(args.path)}; export default shared;`, loader: 'js' }))
  } }],
})
const modules = []
const publicAssets = []
for (const [path, meta] of Object.entries(result.metafile.outputs)) {
  const asset = relative(output, resolve(path))
  if (!meta.entryPoint) { publicAssets.push(asset); continue }
  const name = meta.entryPoint.split('/').at(-1).replace(/\.tsx?$/, '')
  if (path.endsWith('.js')) modules.push({ id: `youdub.${name}`, version: '1.0.0', access: publicModules.has(name) ? 'public' : 'authenticated', url: `/api/plugins/youdub-client/1.0.0/${asset}` })
}
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ version: 1, sdkVersion: '1.0.0', platformVersion: '1', modules, publicAssets }, null, 2) + '\n')
const platformDir = resolve(root, 'public/plugin-platform/1')
await mkdir(platformDir, { recursive: true })
const sdkExports = ['SDK_VERSION', 'PluginContextProvider', 'useClient', 'useObservable', 'useSlot', 'usePathname', 'Link', 'text', 'matchRoute', 'parseManifest', 'requireActive']
for (const [specifier, asset] of Object.entries(shared)) {
  const namespace = specifier === 'cordis' ? await import('cordis') : specifier === '@youdub/sdk/client' ? null : require(specifier)
  const names = (namespace ? Object.keys(namespace) : sdkExports).filter((key) => key !== 'default' && /^[A-Za-z_$][\w$]*$/.test(key))
  const code = `const namespace = globalThis.__YOUDUB_PLATFORM__?.[${JSON.stringify(specifier)}];\nif (!namespace) throw new Error(${JSON.stringify(`Platform module not initialized: ${specifier}`)});\n` + names.map((key) => `export const ${key} = namespace.${key};`).join('\n') + '\nexport default namespace;\n'
  await writeFile(resolve(platformDir, `${asset}.mjs`), code)
}
console.log(`Built ${modules.length} Client plugins and shared platform bridges.`)
