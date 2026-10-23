// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { StudioDraftStore } from './studio-draft'
import type { Request } from '@/plugin/runtime/types'

it('retains uncertain submissions and retries their frozen request until explicit successful cleanup', async () => {
  const store = new StudioDraftStore(), body = new FormData()
  body.set('request', JSON.stringify({ id: 'fixed', config: { mode: 'first' } }))
  const request = vi.fn().mockRejectedValueOnce(new Error('Connection interrupted')).mockRejectedValueOnce(new Error('Still unavailable')).mockRejectedValueOnce(new Error('Cleanup failed')).mockResolvedValueOnce(undefined)
  await store.submit('composer:test', request as Request, body)
  body.set('request', JSON.stringify({ id: 'different', config: { mode: 'changed' } }))
  await store.submit('composer:test', request as Request, body)
  expect(request.mock.calls[1][1].body).toBe(request.mock.calls[0][1].body)
  expect(JSON.parse(request.mock.calls[1][1].body.get('request'))).toEqual({ id: 'fixed', config: { mode: 'first' } })
  expect(store.getSnapshot().submissions['composer:test']).toMatchObject({ id: 'fixed', busy: false, error: 'Still unavailable' })
  expect(await store.discard('composer:test', request as Request)).toBe(false)
  expect(store.getSnapshot().submissions['composer:test'].error).toBe('Cleanup failed')
  expect(await store.discard('composer:test', request as Request)).toBe(true)
  expect(store.getSnapshot().submissions).toEqual({})
})

it('clears only the graph that started and keeps other workflow configuration and composer files', () => {
  const store = new StudioDraftStore(), file = new File(['text'], 'draft.txt')
  store.set('composers', { external: { files: { input: file }, sourceUrl: '', config: { mode: 'keep' } } })
  store.set('draft', { selectedFiles: [], sourceUrl: 'https://youtu.be/jNQXAC9IVRw', runtimeByDocument: { current: { node: { value: 1 } }, other: { node: { value: 2 } } } })
  store.set('overrides', { current: { node: { value: 1 } }, other: { node: { value: 2 } } })
  store.clearGraph('current')
  expect(store.getSnapshot().composers.external.files.input).toBe(file)
  expect(store.getSnapshot().draft).toEqual({ selectedFiles: [], sourceUrl: '', runtimeByDocument: { other: { node: { value: 2 } } } })
  expect(store.getSnapshot().overrides).toEqual({ other: { node: { value: 2 } } })
})
