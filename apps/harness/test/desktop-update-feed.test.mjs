import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeUpdateFeed, verifyUpdateFeed } from '../../../scripts/desktop-update-feed.mjs'

for (const [platform, file, feed] of [['darwin', 'macOS-arm64.zip', 'latest-mac.yml'], ['win32', 'windows-x64-Setup.exe', 'latest.yml']]) {
  test(platform + ' feed pins the release artifact and fails when its bytes or version change', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'youdub-update-feed-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const artifact = join(directory, 'YouDub-1.2.3-' + file)
    await writeFile(artifact, 'candidate artifact')
    await writeUpdateFeed(directory, '1.2.3', platform)
    const metadata = JSON.parse(await readFile(join(directory, feed), 'utf8'))
    assert.equal(metadata.files[0].url, 'https://github.com/liuzhao1225/YouDub-webui/releases/download/v1.2.3/YouDub-1.2.3-' + file)
    await verifyUpdateFeed(directory, '1.2.3', platform)
    await writeFile(artifact, 'corrupted artifact')
    await assert.rejects(verifyUpdateFeed(directory, '1.2.3', platform), /mismatch/)
    await writeFile(artifact, 'candidate artifact')
    metadata.version = '1.2.4'
    await writeFile(join(directory, feed), JSON.stringify(metadata))
    await assert.rejects(verifyUpdateFeed(directory, '1.2.3', platform), /mismatch/)
  })
}
