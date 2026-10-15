import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { demos } from '../site/demos.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const destination = join(root, 'apps/web/public/examples')
await mkdir(join(destination, 'assets'), { recursive: true })
await cp(join(root, 'apps/web/templates/examples.html'), join(destination, 'index.html'))
for (const file of ['player.js', 'demos.js', 'style.css', 'assets/youdub-logo.svg', 'assets/youdub-icon.svg',
  ...Object.keys(demos).flatMap(id => [`assets/${id}-en.mp4`, `assets/${id}-zh.mp4`, `assets/${id}-poster.jpg`])]) {
  await cp(join(root, 'site', file), join(destination, file))
}
console.log(`Bundled ${Object.keys(demos).length} bilingual examples from site assets.`)
