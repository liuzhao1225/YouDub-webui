// The record half of the seam: the store keeps an owner's payload verbatim,
// presence rather than content answers "configured", and every write goes
// through one serialized read-modify-write so a rotating credential cannot be
// lost between processes.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialKey, credentialKeyScope, credentialRef, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'

/** Credential documents are seeded owner-only, exactly as the provider creates them. */
function writeCredentials(file: string, text: string): Promise<void> {
  return writeFile(file, text, { mode: 0o600 })
}

const CODEX = credentialKey('llm-pi-ai', 'openai-codex')
const BEDROCK = credentialKey('llm-pi-ai', 'amazon-bedrock')
const OTHER_OWNER = credentialKey('llm-kimi', 'openai-codex')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cred-records-'))
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

/** Store one record outright; the seam offers only the read-modify-write path. */
function put(ctx: Context, key: CredentialKey, record: CredentialRecord): Promise<CredentialRecord | undefined> {
  return ctx.credentials.modifyRecord(key, () => Promise.resolve(record))
}

function recordUpdates(ctx: Context): CredentialKey[] {
  const seen: CredentialKey[] = []
  ctx.on('credentials/record-updated', (key) => { seen.push(key) })
  return seen
}

describe('credential keys', () => {
  it('rejects a segment that is not a lowercase hyphenated identifier', () => {
    expect(() => credentialKey('llm-pi-ai', 'OpenAI')).toThrow(/credential key segment/)
    expect(() => credentialKey('', 'codex')).toThrow(/credential key segment/)
  })

  it('stays disjoint from the reference grammar', () => {
    // The `/` is what makes the two key spaces incapable of colliding, so a
    // record address can never be mistaken for an environment-variable name.
    expect(() => credentialRef(CODEX)).toThrow(/credential ref/)
  })

  it('reads back the owning plugin, which is what makes an orphan recognizable', () => {
    expect(credentialKeyScope(CODEX)).toBe('llm-pi-ai')
    expect(credentialKeyScope(OTHER_OWNER)).toBe('llm-kimi')
  })

  it('admits a stored key and refuses one that is not two segments', () => {
    expect(parseCredentialKey('llm-pi-ai/openai-codex')).toBe(CODEX)
    expect(() => parseCredentialKey('openai-codex')).toThrow(/must be "<scope>\/<id>"/)
    expect(() => parseCredentialKey('a/b/c')).toThrow(/must be "<scope>\/<id>"/)
  })
})

describe('record storage', () => {
  it('returns a grant payload exactly as its owner wrote it', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    // Fields the seam has never heard of ride along: an owner's SDK gains them
    // between releases, and a whitelist here would silently eat the new ones.
    const payload = { type: 'oauth', access: 'at', refresh: 'rt', expires: 1786000000000, accountId: 'acct_1' }
    await put(ctx, CODEX, { kind: 'grant', payload })

    expect(await ctx.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload })
    const reread = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    expect(await reread.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload })
  })

  it('treats a record carrying no key and no environment as configured', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    // The owner confirmed this route authenticates from its own ambient
    // discovery. That is a stored decision, not a blank — the opposite reading
    // of the empty-value rule the reference half follows.
    await put(ctx, BEDROCK, { kind: 'api-key' })

    expect(await ctx.credentials.describeRecord(BEDROCK)).toEqual({ configured: true, kind: 'api-key', writable: true })
  })

  it('describes an absent record as unconfigured but writable', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })

    expect(await ctx.credentials.describeRecord(CODEX)).toEqual({ configured: false, writable: true })
    expect(await ctx.credentials.readRecord(CODEX)).toBeUndefined()
  })

  it('stores provider environment values beside or instead of a key', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    await put(ctx, BEDROCK, { kind: 'api-key', env: { AWS_PROFILE: 'prod' } })

    expect(await ctx.credentials.readRecord(BEDROCK)).toEqual({ kind: 'api-key', env: { AWS_PROFILE: 'prod' } })
  })

  it('keeps references and records in one document without either disturbing the other', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot({ path, watch: false })
    await ctx.credentials.set(credentialRef('DSH_RECORDS_KEY'), 'sk-live')
    await put(ctx, CODEX, { kind: 'grant', payload: { token: 't' } })

    const text = await readFile(path, 'utf8')
    expect(text).toBe(
      'version: 1\nrefs:\n  DSH_RECORDS_KEY: sk-live\nrecords:\n'
      + '  llm-pi-ai/openai-codex:\n    kind: grant\n    payload:\n      token: t\n',
    )
    expect(await ctx.credentials.resolve(credentialRef('DSH_RECORDS_KEY'))).toEqual({ value: 'sk-live', source: 'file' })
  })

  it('reads every record shape back off disk', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    // Written by hand rather than through the API: this is the parse path, and
    // an api-key record is legal with a key, with environment values, with
    // both, or with neither.
    await writeCredentials(path, 'version: 1\nrecords:\n'
      + '  llm-pi-ai/openai-codex:\n    kind: grant\n    payload:\n      access: at\n'
      + '  llm-pi-ai/amazon-bedrock:\n    kind: api-key\n    env:\n      AWS_PROFILE: prod\n'
      + '  llm-pi-ai/azure:\n    kind: api-key\n    key: sk-azure\n'
      + '  llm-pi-ai/both:\n    kind: api-key\n    key: sk-both\n    env:\n      REGION: eu\n'
      + '  llm-pi-ai/ambient:\n    kind: api-key\n')
    const ctx = await boot({ path, watch: false })

    expect(await ctx.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload: { access: 'at' } })
    expect(await ctx.credentials.readRecord(BEDROCK)).toEqual({ kind: 'api-key', env: { AWS_PROFILE: 'prod' } })
    expect(await ctx.credentials.readRecord(credentialKey('llm-pi-ai', 'azure')))
      .toEqual({ kind: 'api-key', key: 'sk-azure' })
    expect(await ctx.credentials.readRecord(credentialKey('llm-pi-ai', 'both')))
      .toEqual({ kind: 'api-key', key: 'sk-both', env: { REGION: 'eu' } })
    expect(await ctx.credentials.readRecord(credentialKey('llm-pi-ai', 'ambient'))).toEqual({ kind: 'api-key' })
  })

  it('publishes a record an external edit reshaped, whatever shape it took', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot({ path, watch: false })
    await put(ctx, CODEX, { kind: 'grant', payload: { scopes: ['a'] } })
    const seen = recordUpdates(ctx)

    // A sequence where a mapping stood, then a mapping that gained a field:
    // neither is caught by an identity check, and reporting them as unchanged
    // would leave a stale credential on every configuration surface.
    for (const payload of ['[1]', '{a: 1}', '{a: 1, b: 2}']) {
      await writeCredentials(path, 'version: 1\nrecords:\n  llm-pi-ai/openai-codex:\n'
        + `    kind: grant\n    payload: ${payload}\n`)
      // Any write folds the unobserved document in before committing its own.
      await put(ctx, BEDROCK, { kind: 'api-key' })
    }

    expect(seen.filter(key => key === CODEX)).toHaveLength(3)
    expect(await ctx.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload: { a: 1, b: 2 } })
  })

  it('keeps two owners of the same provider id apart', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    await put(ctx, CODEX, { kind: 'grant', payload: { owner: 'pi-ai' } })
    await put(ctx, OTHER_OWNER, { kind: 'grant', payload: { owner: 'kimi' } })

    expect(await ctx.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload: { owner: 'pi-ai' } })
    expect(await ctx.credentials.readRecord(OTHER_OWNER)).toEqual({ kind: 'grant', payload: { owner: 'kimi' } })
  })
})

describe('record mutation', () => {
  it('shows the mutation the record as it stands and commits its replacement', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    await put(ctx, CODEX, { kind: 'grant', payload: { expires: 1 } })
    const seen: Array<CredentialRecord | undefined> = []

    const next = await ctx.credentials.modifyRecord(CODEX, (current) => {
      seen.push(current)
      return Promise.resolve({ kind: 'grant', payload: { expires: 2 } })
    })

    expect(seen).toEqual([{ kind: 'grant', payload: { expires: 1 } }])
    expect(next).toEqual({ kind: 'grant', payload: { expires: 2 } })
  })

  it('leaves the entry untouched when the mutation declines', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot({ path, watch: false })
    await put(ctx, CODEX, { kind: 'grant', payload: { expires: 1 } })
    const before = await readFile(path, 'utf8')
    const seen = recordUpdates(ctx)

    // The refresh path declines whenever a second reader finds the credential
    // already rotated; declining must not rewrite the document or announce a
    // change that did not happen.
    const result = await ctx.credentials.modifyRecord(CODEX, () => Promise.resolve(undefined))

    expect(result).toEqual({ kind: 'grant', payload: { expires: 1 } })
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(seen).toEqual([])
  })

  it('announces a committed write and a committed delete, and stays silent on an absent delete', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    const seen = recordUpdates(ctx)

    await put(ctx, CODEX, { kind: 'grant', payload: 1 })
    await ctx.credentials.deleteRecord(CODEX)
    await ctx.credentials.deleteRecord(CODEX)

    expect(seen).toEqual([CODEX, CODEX])
    expect(await ctx.credentials.readRecord(CODEX)).toBeUndefined()
  })

  it('removes a later record without disturbing the annotation above the first', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    // The comment sits above the section's first entry, where the parser
    // attaches it to the section rather than to the pair. Removing a *later*
    // entry must leave it exactly where it is.
    await writeCredentials(path, 'version: 1\nrecords:\n  # the one to keep\n'
      + '  llm-pi-ai/openai-codex:\n    kind: grant\n    payload: 1\n'
      + '  llm-pi-ai/amazon-bedrock:\n    kind: api-key\n')
    const ctx = await boot({ path, watch: false })

    await ctx.credentials.deleteRecord(BEDROCK)

    expect(await readFile(path, 'utf8')).toBe('version: 1\nrecords:\n  # the one to keep\n'
      + '  llm-pi-ai/openai-codex:\n    kind: grant\n    payload: 1\n')
  })

  it('folds an unobserved external record edit into a write instead of overwriting it', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot({ path, watch: false })
    await put(ctx, CODEX, { kind: 'grant', payload: { v: 1 } })
    // Landed on disk with no watcher to report it — the same blind spot as a
    // debounce window, a missed event, or another process's write.
    await writeCredentials(path, 'version: 1\nrecords:\n'
      + '  llm-pi-ai/openai-codex:\n    kind: grant\n    payload:\n      v: 1\n'
      + '  llm-pi-ai/amazon-bedrock:\n    kind: api-key\n    env:\n      AWS_PROFILE: prod\n')

    await put(ctx, CODEX, { kind: 'grant', payload: { v: 2 } })

    expect(await ctx.credentials.readRecord(BEDROCK)).toEqual({ kind: 'api-key', env: { AWS_PROFILE: 'prod' } })
    expect(await ctx.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload: { v: 2 } })
  })

  it('keeps both records when two providers write the same document concurrently', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const first = await boot({ path, watch: false })
    const second = await boot({ path, watch: false })

    await Promise.all([
      (async () => {
        for (const v of [1, 2, 3]) await put(first, CODEX, { kind: 'grant', payload: { v } })
      })(),
      (async () => {
        for (const v of [1, 2, 3]) await put(second, BEDROCK, { kind: 'grant', payload: { v } })
      })(),
    ])

    const reread = await boot({ path, watch: false })
    expect(await reread.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload: { v: 3 } })
    expect(await reread.credentials.readRecord(BEDROCK)).toEqual({ kind: 'grant', payload: { v: 3 } })
  })

  it('enumerates stored records by address and tag, never by value', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    await put(ctx, CODEX, { kind: 'grant', payload: { secret: 'do-not-list' } })
    await put(ctx, BEDROCK, { kind: 'api-key', key: 'sk-listed' })

    const listed = await ctx.credentials.listRecords()

    expect(listed).toEqual([{ key: CODEX, kind: 'grant' }, { key: BEDROCK, kind: 'api-key' }])
    expect(JSON.stringify(listed)).not.toContain('do-not-list')
    expect(JSON.stringify(listed)).not.toContain('sk-listed')
  })

  it('refuses a payload this document could not read back', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot({ path, watch: false })

    // An owner's SDK value that YAML would either lose or re-read as another
    // type. Rejecting on the way in is what keeps the round-trip promise
    // keepable; a rejected value must also leave nothing behind.
    for (const payload of [{ at: new Date(0) }, { size: 1n }, { run: () => undefined }, { ratio: Number.NaN }]) {
      await expect(put(ctx, CODEX, { kind: 'grant', payload }))
        .rejects.toThrow(/record "llm-pi-ai\/openai-codex" payload/)
    }
    expect(await ctx.credentials.readRecord(CODEX)).toBeUndefined()
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses an api-key record this document could not read back', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot({ path, watch: false })

    // The same admission rule as the read path: an api-key record parseRecord
    // would reject at the next boot is refused before it is rendered, so the
    // current process can never report a success the next one refuses to load.
    await expect(put(ctx, CODEX, { kind: 'api-key', key: '' }))
      .rejects.toThrow(/empty key/)
    await expect(put(ctx, CODEX, { kind: 'api-key', env: { 'not a name': 'value' } }))
      .rejects.toThrow(/must match/)
    await expect(put(ctx, CODEX, { kind: 'api-key', env: { AWS_REGION: '' } }))
      .rejects.toThrow(/non-empty string/)
    expect(await ctx.credentials.readRecord(CODEX)).toBeUndefined()
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses record writes once disposed', async () => {
    const dir = await tempDir()
    const ctx = new Context()
    const fiber = ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await fiber
    const credentials = ctx.credentials
    await fiber.dispose()

    await expect(credentials.modifyRecord(CODEX, () => Promise.resolve({ kind: 'grant', payload: 1 })))
      .rejects.toThrow(/disposed/)
    await expect(credentials.deleteRecord(CODEX)).rejects.toThrow(/disposed/)
  })
})
