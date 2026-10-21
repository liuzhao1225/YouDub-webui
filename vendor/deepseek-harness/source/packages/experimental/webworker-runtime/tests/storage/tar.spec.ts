/**
 * The bare-tar image codec: byte-faithful roundtrip through packTar/parseTar
 * and the VFS mount the worker performs on that archive.
 */
import { describe, expect, it } from 'vitest'
import { packTar, parseTar } from '../../src/storage/tar.ts'
import { loadVfsImage, loadVfsOverlay } from '../../src/storage/memory.ts'

const encoder = new TextEncoder()

describe('tar codec', () => {
  it('roundtrips files and empty directories byte-faithfully', () => {
    const payload = new Uint8Array([0, 1, 2, 253, 254, 255])
    const files = {
      'config/cordis.yml': encoder.encode('- id: subject\n'),
      'node_modules/pkg/lib/index.js': payload,
      'home/': new Uint8Array(0),
    }
    const entries = parseTar(packTar(files))
    const byName = new Map(entries.map(entry => [entry.name, entry]))
    expect([...byName.keys()].sort()).toEqual(Object.keys(files).sort())
    expect([...byName.get('node_modules/pkg/lib/index.js')!.bytes]).toEqual([...payload])
    expect(byName.get('home/')!.bytes.byteLength).toBe(0)
    // The header mode field carries the packed permission bits: normal
    // 644/755, which the VFS mount reports back through stat.
    expect(byName.get('node_modules/pkg/lib/index.js')!.mode).toBe(0o644)
    expect(byName.get('home/')!.mode).toBe(0o755)
  })

  it('mounts as a VFS with directories synthesized along file paths', () => {
    const vfs = loadVfsImage(packTar({
      'config/cordis.yml': encoder.encode('- id: subject\n'),
      'workspace/': new Uint8Array(0),
    }), '/dsh')
    expect(vfs.existsSync('/dsh/config/cordis.yml')).toBe(true)
    expect(vfs.readFileSync('/dsh/config/cordis.yml', 'utf8')).toBe('- id: subject\n')
    expect(vfs.existsSync('/dsh/config')).toBe(true)
    expect(vfs.existsSync('/dsh/workspace')).toBe(true)
    expect(vfs.existsSync('/dsh/absent')).toBe(false)
  })

  it('applies ordered data overlays without exposing runtime paths', () => {
    const vfs = loadVfsImage(packTar({
      'config/cordis.yml': encoder.encode('- id: subject\n'),
      'workspace/status.txt': encoder.encode('base'),
    }), '/dsh')
    loadVfsOverlay(packTar({
      'workspace/status.txt': encoder.encode('fixture'),
      'home/sessions/example/session.jsonl': encoder.encode('{}\n'),
    }), '/dsh', vfs)
    expect(vfs.readFileSync('/dsh/workspace/status.txt', 'utf8')).toBe('fixture')
    expect(vfs.readFileSync('/dsh/home/sessions/example/session.jsonl', 'utf8')).toBe('{}\n')
    expect(() => loadVfsOverlay(packTar({
      'config/cordis.yml': encoder.encode('replaced'),
    }), '/dsh', vfs)).toThrow(/overlay entry must stay under home\/ or workspace/)
    expect(vfs.readFileSync('/dsh/config/cordis.yml', 'utf8')).toBe('- id: subject\n')
  })
})
