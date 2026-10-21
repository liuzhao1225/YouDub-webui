// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('.', import.meta.url))
it('keeps runtime modules independent of React and feature components independent of the Cordis context', async () => {
  for (const name of await readdir(`${root}/runtime`)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    const source = await readFile(`${root}/runtime/${name}`, 'utf8')
    expect(source, name).not.toMatch(/from\s+['"](?:react(?:-dom)?(?:\/[^'"]*)?|[^'"]*web-react|[^'"]*legacy)['"]|\buseSyncExternalStore\b/)
  }
  for (const name of await readdir(`${root}/builtin`)) {
    if (!name.endsWith('.tsx')) continue
    const source = await readFile(`${root}/builtin/${name}`, 'utf8')
    expect(source, name).not.toMatch(/\buseClient\b|\buseSyncExternalStore\b|\bfetch\s*\(/)
  }
})
