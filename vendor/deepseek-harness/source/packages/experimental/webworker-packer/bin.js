#!/usr/bin/env node
/**
 * Stable link target for the `dsh-pack-vfs-image` bin, forwarding to the build
 * product.
 *
 * pnpm creates a workspace package's bin link only when the link target exists
 * at install time. `lib/bin.js` is a build product and is absent on a clean
 * checkout, so this committed file is the link target; it forwards to the build
 * product when the command runs.
 * @module @deepseek-ai/dsh-experimental-webworker-packer/bin
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = new URL('./lib/bin.js', import.meta.url)
if (!existsSync(fileURLToPath(entry))) {
  process.stderr.write('dsh-pack-vfs-image: lib/bin.js is missing — run `pnpm run build` before packing an image\n')
  process.exit(1)
}
await import(entry.href)
