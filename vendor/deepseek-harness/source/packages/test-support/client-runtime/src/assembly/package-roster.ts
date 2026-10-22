/** Explicit library-test composition, independent of the application's enabled feature list. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseDshClient } from '@deepseek-ai/dsh-client-modules/client'
import { ClientRoster, type ClientRosterRow } from './roster.ts'

/**
 * Read retained package manifests and select the actual client dependency closure.
 * Product tests continue to use webApp; this helper never changes the product bundle.
 * @param names - explicit framework feature owners under test.
 * @returns their real client modules plus the shared module and connection bootstrap.
 */
export function packageRoster(names: readonly string[]): ClientRoster {
  const packages = resolve(import.meta.dirname, '../../../..')
  const rows: ClientRosterRow[] = []
  for (const group of readdirSync(packages, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const pkg of readdirSync(join(packages, group.name), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      const file = join(packages, group.name, pkg.name, 'package.json')
      if (!existsSync(file)) continue
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as { name: string; dsh?: { client?: unknown } }
      const client = parseDshClient(manifest.name, manifest.dsh?.client)
      if (client?.platform !== 'web') continue
      rows.push({ name: manifest.name, inject: client.inject ?? [], immediately: client.immediately === true })
    }
  }
  return ClientRoster.of(rows).closure(['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-connection', ...names])
}
