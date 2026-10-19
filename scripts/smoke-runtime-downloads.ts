/** Network smoke: real pinned domestic downloads, Unicode extraction, Python and FFmpeg execution. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { DownloadClient } from '../packages/builtin/src/setup-download.js'
import manifest from '../packages/builtin/src/setup-runtime.json' with { type: 'json' }

const platform = `${process.platform}-${process.arch}` as keyof typeof manifest.python
const windows = process.platform === 'win32'
const root = resolve('.cache/runtime-download-smoke/用户 空格 # [测试]')
const client = new DownloadClient()
const run = promisify(execFile)
const signal = AbortSignal.timeout(10 * 60_000)
Object.assign(process.env, { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1' })
await mkdir(root, { recursive: true })
try {
  const asset = manifest.python[platform]
  await client.download(asset, join(root, asset.path), signal, () => {})
  const tar = windows ? join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe') : '/usr/bin/tar'
  await run(tar, ['-xf', asset.path], { cwd: root, windowsHide: true, signal })
  const python = join(root, 'python', windows ? 'python.exe' : 'bin/python3')
  await run(python, ['-m', 'venv', join(root, 'venv')], { signal, windowsHide: true })
  const venv = join(root, 'venv', windows ? 'Scripts/python.exe' : 'bin/python')
  const version = await run(venv, ['-c', 'import sys, ssl, lzma, ensurepip; assert sys.version_info[:2] == (3,12); print(sys.version)'], { signal, windowsHide: true })
  const media = join(root, 'media')
  await mkdir(media, { recursive: true })
  for (const file of manifest.ffmpeg[platform]) {
    const path = join(media, file.path)
    await client.download(file, path, signal, () => {})
    if (windows) await run(venv, ['-c', 'import sys, tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2], filter="data")', path, media], { signal, windowsHide: true })
    else await chmod(path, 0o700)
  }
  const bin = windows ? join(media, 'ffmpeg-7.1.5-win32-x64-gpl-shared/bin') : media
  const ffmpeg = join(bin, windows ? 'ffmpeg.exe' : `ffmpeg-${platform}`)
  const ffprobe = join(bin, windows ? 'ffprobe.exe' : `ffprobe-${platform}`)
  const filters = await run(ffmpeg, ['-hide_banner', '-filters'], { signal, windowsHide: true })
  assert.match(filters.stdout, /\bsubtitles\b/)
  if (windows) assert.ok((await readdir(bin)).some(file => /^avcodec-\d+\.dll$/.test(file)))
  const audio = join(root, '声音.wav')
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=0.1', audio], { signal, windowsHide: true })
  const probe = await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'json', audio], { signal, windowsHide: true })
  assert.equal(JSON.parse(probe.stdout).streams[0].codec_name, 'pcm_s16le')
  await client.download(manifest.punkt, join(root, manifest.punkt.path), signal, () => {})
  await run(venv, ['-m', 'zipfile', '-e', join(root, manifest.punkt.path), join(root, 'nltk_data')], { signal, windowsHide: true })
  assert.equal((await readdir(join(root, 'nltk_data/punkt_tab/english'))).length, 4)
  const result = { platform, python: version.stdout.trim(), ffmpeg: 'subtitles + audio encode/decode passed', proxy: 'unreachable proxy bypassed', resources: 'SHA-256 verified' }
  await writeFile(resolve('.cache/runtime-download-smoke/result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(result)
} finally { await client.close() }
