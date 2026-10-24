import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ArtifactDescriptor } from '@youdub/sdk'
import Files from '../src/files.js'

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-files-')), ctx = new Context()
  const probes: string[][] = []
  const app = await ctx.plugin(async context => {
    await context.plugin(services => {
      services.reflect.provide('youdubWorker', { async run(request: { args: string[] }) {
        probes.push(request.args)
        return { stdout: JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '1.250' } }) }
      } })
    })
    await context.plugin(Files, { root })
  })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true }) })
  const id = randomUUID(), invocationId = randomUUID(), work = await ctx.files.workDir(id, 1, invocationId)
  const metadata = { sampleRate: 16000, channels: 1, sampleCount: 20000 }
  const wav = Buffer.alloc(44 + metadata.sampleCount * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(metadata.channels, 22)
  wav.writeUInt32LE(metadata.sampleRate, 24); wav.writeUInt32LE(metadata.sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  await writeFile(join(work, 'reference.wav'), wav)
  const descriptor: ArtifactDescriptor = { path: 'reference.wav', mimeType: 'audio/wav', schemaId: 'audio/wav/v1', metadata }
  const register = (changes: Partial<ArtifactDescriptor> = {}) => ctx.files.register(id, invocationId, work, { ...descriptor, ...changes })
  return { register, descriptor, probes, work, wav }
}

test('measured WAV registration preserves metadata and derives duration without another process', async t => {
  const { register, descriptor, probes, wav } = await setup(t)
  const artifact = await register()
  assert.deepEqual(artifact.metadata, { ...descriptor.metadata, durationMs: 1250 })
  assert.equal(artifact.size, wav.length)
  assert.equal(probes.length, 0)
})

test('media without usable WAV measurements retains FFprobe inspection', async t => {
  const { register, descriptor, probes, work } = await setup(t)
  for (const changes of [
    { metadata: {} },
    { metadata: { ...descriptor.metadata, sampleRate: 0 } },
    { metadata: { ...descriptor.metadata, sampleCount: NaN } },
    { metadata: { ...descriptor.metadata, channels: 0 } },
    { schemaId: 'file/v1' },
    { mimeType: 'audio/mpeg' },
  ]) {
    const previous = probes.length
    assert.equal((await register(changes)).metadata.durationMs, 1250)
    assert.equal(probes.length, previous + 1)
    assert.equal(probes.at(-1)!.at(-1), await realpath(join(work, 'reference.wav')))
  }
})

test('measured WAV metadata cannot bypass workspace and nonempty file checks', async t => {
  const { register, work, wav, probes } = await setup(t)
  await writeFile(join(work, 'empty.wav'), '')
  await writeFile(join(work, '../outside.wav'), wav)
  await assert.rejects(register({ path: 'empty.wav' }), { code: 'STAGE_OUTPUT_MISSING' })
  await assert.rejects(register({ path: '../outside.wav' }), { code: 'INVALID_PROVIDER_RESULT' })
  assert.equal(probes.length, 0)
})
