/** Temporary materialized packages for Desktop resource and profile behavior tests. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { DESKTOP_RUNTIME_FILE, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

/**
 * Write a package fixture with explicit runtime exports.
 * @param modules - Owning node_modules directory.
 * @param name - Package name.
 * @param fields - Manifest fields.
 * @param source - ESM entry contents.
 * @returns Installed package directory.
 */
export function writePackage(modules: string, name: string, fields: Record<string, unknown> = {}, source = 'export const identity = {}\n'): string {
  const path = join(modules, name)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './index.js', ...fields }))
  writeFileSync(join(path, 'index.js'), source)
  return path
}

/**
 * Write a minimal release containing Host entry files and shared package metadata.
 * @param root - New runtime directory.
 * @param version - Shell and dsh version.
 * @param nodeVersion - Bundled Node version recorded in resource metadata.
 * @returns Runtime metadata used by profile tests.
 */
export function runtimeFixture(root: string, version = '1.0.0', nodeVersion = '24.17.0'): DesktopRuntimeDescriptor {
  const names = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/cordis']
  for (const name of names) {
    const bundle = name === '@deepseek-ai/dsh-base' || name === '@deepseek-ai/dsh-web-app'
    const path = writePackage(join(root, 'node_modules'), name, {
      version,
      ...(name === '@deepseek-ai/dsh' ? { dependencies: Object.fromEntries(names.slice(1).map(dependency => [dependency, version])) } : {}),
      ...(bundle ? { dsh: { bundle: { patch: './bundle.yml' } } } : {}),
    })
    if (bundle) writeFileSync(join(path, 'bundle.yml'), '[]\n')
  }
  const hostEntry = join(root, 'node_modules', '@deepseek-ai/dsh-desktop-host', 'lib/index.js')
  mkdirSync(join(hostEntry, '..'), { recursive: true })
  writeFileSync(hostEntry, '')
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  const descriptor: DesktopRuntimeDescriptor = {
    schemaVersion: 1,
    release: { schemaVersion: 1, version, nodeVersion, pnpmVersion: '11.7.0', hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION },
    platform: process.platform, arch: process.arch,
    sharedPackages: names.map(name => ({ name, version, path: `node_modules/${name}` })),
    files: [],
  }
  writeFileSync(join(root, DESKTOP_RUNTIME_FILE), JSON.stringify(descriptor))
  return descriptor
}
