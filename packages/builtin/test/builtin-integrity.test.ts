import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinIntegrities, reviewedIntegrities } from '../src/builtin-integrity.js'

test('execution identities ignore settings and templates but change for the affected model implementation', async () => {
  const edits = new Map<string, string>(), reads = new Set<string>()
  const read = async (path: string) => { reads.add(path); return Buffer.from(edits.get(path) ?? path) }
  const before = await builtinIntegrities('/app', read)
  edits.set('/app/apps/harness/src/backend/settings.mjs', 'unrelated settings change')
  edits.set('/app/apps/harness/src/backend/setup.mjs', 'unrelated setup change')
  edits.set('/app/packages/builtin/src/workflow-templates/reviewed-subtitles.json', 'new template')
  assert.deepEqual(await builtinIntegrities('/app', read), before)
  assert.ok(!reads.has('/app/apps/harness/src/backend/settings.mjs'))
  edits.set('/app/backend/app/v1/asr.py', 'new recognition behavior')
  const changed = await builtinIntegrities('/app', read)
  assert.notEqual(changed.whisper.integrity, before.whisper.integrity)
  for (const id of Object.keys(before).filter(id => id !== 'whisper')) assert.equal(changed[id].integrity, before[id].integrity, id)
})

test('a reviewed compatibility mapping expires when the current implementation changes', () => {
  const records = { provider: { integrity: 'reviewed-current', previous: ['verified-old'] } }
  assert.deepEqual(reviewedIntegrities('provider', 'reviewed-current', records), ['verified-old'])
  assert.deepEqual(reviewedIntegrities('provider', 'future-unreviewed', records), [])
  assert.deepEqual(reviewedIntegrities('other', 'reviewed-current', records), [])
})
