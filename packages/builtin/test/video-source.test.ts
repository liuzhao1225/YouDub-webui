import { test } from 'node:test'
import assert from 'node:assert/strict'
import { videoSource } from '@youdub/sdk/video-source'

test('normalizes video and pasted share links without tracking parameters', () => {
  for (const url of ['https://youtu.be/jNQXAC9IVRw?si=tracking', 'https://www.youtube.com/shorts/jNQXAC9IVRw', 'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=other']) {
    assert.equal(videoSource(url).url, 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
  }
  assert.equal(videoSource('【视频】 https://b23.tv/abc123 分享').url, 'https://b23.tv/abc123')
  assert.equal(videoSource('https://m.bilibili.com/video/BV1r44y1f7Tc/?p=2&share_source=copy').url, 'https://www.bilibili.com/video/BV1r44y1f7Tc/?p=2')
})
test('rejects arbitrary hosts, playlists and private targets', () => {
  for (const url of ['http://127.0.0.1/a', 'https://youtube.com.evil.com/watch?v=jNQXAC9IVRw', 'https://www.youtube.com/playlist?list=x', 'https://user:pass@youtu.be/jNQXAC9IVRw', 'https://b23.tv:8000/abc', 'hello']) assert.throws(() => videoSource(url))
})
