// One-shot boot upgrade of the pre-release flat layout: a key stored by an
// earlier build must survive the versioned-document change without a hand
// edit, byte for byte, while everything the recognizer cannot prove flat
// keeps the loud rejection local.spec exercises.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { LocalCredentialProvider, renderFlatLayoutMigration } from '../src/index.ts'

/** Credential documents are seeded owner-only, exactly as the provider creates them. */
function writeCredentials(file: string, text: string): Promise<void> {
  return writeFileAtomic(file, text, { mode: 0o600, dirMode: 0o700 })
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cred-migration-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(config: ConstructorParameters<typeof LocalCredentialProvider>[1]): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, config)
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

// Every spelling an earlier build accepted: plain, quoted, block-scalar, a
// comment header, an interior blank line, and a key that happens to spell a
// section name of the versioned layout.
const FLAT = [
  '# keys stored before the versioned layout',
  'DSH_CRED_TEST: stored',
  '',
  '# annotates the quoted entry',
  "DSH_CRED_OTHER: 'quoted value'",
  'DSH_CRED_BLOCK: |',
  '  first line',
  '  second line',
  'records: tricky',
].join('\n') + '\n'

const MIGRATED = [
  'version: 1',
  'refs:',
  '  # keys stored before the versioned layout',
  '  DSH_CRED_TEST: stored',
  '',
  '  # annotates the quoted entry',
  "  DSH_CRED_OTHER: 'quoted value'",
  '  DSH_CRED_BLOCK: |',
  '    first line',
  '    second line',
  '  records: tricky',
].join('\n') + '\n'

describe('flat-layout boot migration', () => {
  it('upgrades the flat document in place, byte for byte, and serves its keys', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, FLAT)
    const ctx = await boot({ path, watch: false })
    expect(await readFile(path, 'utf8')).toBe(MIGRATED)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toEqual({ value: 'stored', source: 'file' })
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_OTHER')))
      .toEqual({ value: 'quoted value', source: 'file' })
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_BLOCK')))
      .toEqual({ value: 'first line\nsecond line\n', source: 'file' })
    expect(await ctx.credentials.resolve(credentialRef('records'))).toEqual({ value: 'tricky', source: 'file' })
  })

  it('a second boot reads the migrated document without touching it', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, FLAT)
    await boot({ path, watch: false })
    const ctx = await boot({ path, watch: false })
    expect(await readFile(path, 'utf8')).toBe(MIGRATED)
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toEqual({ value: 'stored', source: 'file' })
  })

  it('yields to a concurrent migrator under the writer lock', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, FLAT)
    const winner = 'version: 1\nrefs:\n  DSH_CRED_TEST: winner\n'
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    let acquired!: () => void
    const holding = new Promise<void>((resolve) => { acquired = resolve })
    const holder = withFileLock(path, async () => {
      acquired()
      await held
    })
    await holding
    // The boot sees the flat text, then waits for the lock; the "other
    // process" completes the migration in the meantime.
    const booting = boot({ path, watch: false })
    await writeCredentials(path, winner)
    release()
    await holder
    const ctx = await booting
    expect(await readFile(path, 'utf8')).toBe(winner)
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toEqual({ value: 'winner', source: 'file' })
  })

  it('leaves an empty flow mapping alone', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, '{}\n')
    const ctx = await boot({ path, watch: false })
    expect(await readFile(path, 'utf8')).toBe('{}\n')
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toBeUndefined()
  })

  it('leaves a comment-only document alone', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, '# nothing stored yet\n')
    const ctx = await boot({ path, watch: false })
    expect(await readFile(path, 'utf8')).toBe('# nothing stored yet\n')
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toBeUndefined()
  })

  it('renders a final newline for a document that lacks one', () => {
    expect(renderFlatLayoutMigration('DSH_CRED_TEST: bare')).toBe('version: 1\nrefs:\n  DSH_CRED_TEST: bare\n')
  })
})
