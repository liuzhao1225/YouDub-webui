import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ffmpegDirectory } from '../src/media-paths.js'
import runtimeManifest from '../src/setup-runtime.json' with { type: 'json' }

const sources = runtimeManifest.ffmpeg['win32-x64'].map(asset => asset.directory)

async function extracted(root: string, directory: string) {
  const bin = join(root, 'runtime', 'ffmpeg', directory, 'bin')
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'ffmpeg.exe'), 'managed executable')
  return bin
}

test('Windows 未安装 FFmpeg 时指向首个下载源的目录', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-ffmpeg-directory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(ffmpegDirectory(root, 'win32'), join(root, 'runtime', 'ffmpeg', sources[0]!, 'bin'))
})

test('Windows 按实际解压出的 FFmpeg 目录解析，与命中的下载源无关', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-ffmpeg-directory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const mirror = await extracted(root, sources.at(-1)!)
  assert.equal(ffmpegDirectory(root, 'win32'), mirror)
  const github = await extracted(root, sources[0]!)
  assert.equal(ffmpegDirectory(root, 'win32'), github)
})

test('其他平台直接使用 runtime/ffmpeg', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-ffmpeg-directory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(ffmpegDirectory(root, 'darwin'), join(root, 'runtime', 'ffmpeg'))
})
