import { defineConfig } from 'tsdown'
import { packagedImportsPlugin } from './scripts/desktop-bundle-imports.mjs'

// YouDub bundles its product main process from the same Desktop helpers.
// This framework step supplies the sandboxed preload consumed by that shell.
export default defineConfig({
  entry: { 'preload-app': 'lib/types/preload-app.js' },
  plugins: [packagedImportsPlugin({ packages: new Set(['electron', 'events', 'timers', 'url']), nodeBuiltins: false })],
  outDir: 'lib',
  format: 'cjs',
  codeSplitting: false,
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: ['lib/*.js', 'lib/*.cjs', 'lib/welcome'],
  deps: { neverBundle: ['electron'] },
})
