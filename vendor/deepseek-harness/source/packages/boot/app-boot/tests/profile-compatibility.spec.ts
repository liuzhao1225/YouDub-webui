/** Profile-local compatibility permissions: exact identities and malformed historical data. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { getDshRuntimeVersion } from '../src/index.ts'
import {
  PROFILE_COMPATIBILITY_FILENAME,
  readProfileCompatibility, readProfileVersionExemptions,
} from '../src/profile-compatibility.ts'

const runtime = getDshRuntimeVersion()

function profileFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-compatibility-'))
  onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

function write(dir: string, value: unknown): void {
  writeFileSync(join(dir, PROFILE_COMPATIBILITY_FILENAME), JSON.stringify(value))
}

it('reads no permissions from a profile without a compatibility file', () => {
  expect(readProfileVersionExemptions(profileFixture())).toEqual({})
})

it('reports an unreadable permission file instead of failing the profile', () => {
  const dir = profileFixture()
  mkdirSync(join(dir, PROFILE_COMPATIBILITY_FILENAME))
  const read = readProfileCompatibility(dir)
  expect(read.exemptions).toEqual({})
  expect(read.warnings.join('\n')).toMatch(/cannot be read/)
})

it('reads exact plugin and runtime identities, including build metadata', () => {
  const dir = profileFixture()
  write(dir, { '@scope/plugin@1.2.3+build.7': [runtime, '2.0.0-alpha+runtime'] })
  expect(readProfileVersionExemptions(dir)).toEqual({ '@scope/plugin@1.2.3+build.7': [runtime, '2.0.0-alpha+runtime'] })
})

it.each([
  ['an array', []], ['a string', 'all'], ['null', null],
  ['a non-list value', { 'plugin@1.2.3': '1.2.3' }],
  ['a non-string version', { 'plugin@1.2.3': [1] }],
  ['a range version', { 'plugin@1.2.3': ['^1.2.3'] }],
  ['a range key', { 'plugin@^1.2.3': [runtime] }],
  ['an unversioned key', { plugin: [runtime] }],
])('authorizes nothing for malformed permissions and reports them: %s', (_label, value) => {
  const dir = profileFixture()
  write(dir, value)
  const read = readProfileCompatibility(dir)
  // A bad file must never make the profile unusable: it grants nothing, so incompatible plugins stay denied.
  expect(read.exemptions).toEqual({})
  expect(read.warnings).toHaveLength(1)
  expect(read.warnings[0]).toContain(PROFILE_COMPATIBILITY_FILENAME)
})

it('keeps the records it accepted and reports only the rejected ones', () => {
  const dir = profileFixture()
  write(dir, { 'good@1.2.3': [runtime], 'bad@^1.0.0': [runtime], 'also-good@2.0.0': [] })
  const read = readProfileCompatibility(dir)
  expect(read.exemptions).toEqual({ 'good@1.2.3': [runtime], 'also-good@2.0.0': [] })
  expect(read.warnings).toHaveLength(1)
  expect(read.warnings[0]).toContain('bad@^1.0.0')
})

it('accepts an empty permission list as authorizing nothing', () => {
  const dir = profileFixture()
  write(dir, { 'plugin@1.2.3': [] })
  expect(readProfileVersionExemptions(dir)).toEqual({ 'plugin@1.2.3': [] })
  expect(readProfileCompatibility(dir)).toEqual({ exemptions: { 'plugin@1.2.3': [] }, warnings: [] })
})

it.each(['1.2.3', '1.2.3-alpha.1', '1.2.3+build.7', '1.2.3-alpha+build'])('accepts exact version %s', (version) => {
  const dir = profileFixture()
  const permissions = { [`@scope/plugin@${version}`]: [version] }
  write(dir, permissions)
  expect(readProfileCompatibility(dir)).toEqual({ exemptions: permissions, warnings: [] })
})

it.each([
  ['plugin', '1.2.3'], ['plugin@^1.2.3', '1.2.3'], ['plugin@v1.2.3', '1.2.3'],
  ['plugin@1.2.3', '*'], ['plugin@1.2.3', ' 1.2.3'], ['../plugin@1.2.3', '1.2.3'],
])('rejects noncanonical identity %s / %s', (plugin, version) => {
  const dir = profileFixture()
  write(dir, { [plugin]: [version] })
  const read = readProfileCompatibility(dir)
  expect(read.exemptions).toEqual({})
  expect(read.warnings).toHaveLength(1)
})
