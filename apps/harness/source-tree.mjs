import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readlink } from 'node:fs/promises'
import { join, sep } from 'node:path'

/** Record the same link target across native path separators; preserve POSIX backslashes. */
export async function readLinkTarget(path) {
  return (await readlink(path)).split(sep).join('/')
}

/** Hash file bytes without loading desktop binaries into memory. */
export async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** Record file bytes, executable flags and symlink targets. */
export async function tree(root, { executableModes } = {}) {
  const entries = []
  async function walk(relative) {
    const path = join(root, relative)
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) entries.push({ path: relative, type: 'symlink', target: await readLinkTarget(path) })
    else if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        await walk(relative ? `${relative}/${name}` : name)
      }
    } else if (stat.isFile()) entries.push({ path: relative, type: 'file', executable: executableModes ? (executableModes.get(relative) ?? false) : Boolean(stat.mode & 0o111), size: stat.size, sha256: await sha256(path) })
    else throw new Error(`Unsupported baseline entry: ${path}`)
  }
  await walk('')
  return { sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), files: entries.length, entries }
}
