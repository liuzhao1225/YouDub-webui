import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Agent, fetch } from 'undici'

export interface DownloadFile { url: string; mirrors?: string[]; size: number; sha256: string; path: string }
export interface DownloadSourceEvent { url: string; status: 'connecting' | 'selected' | 'failed'; error?: string }
export function sourceName(url: string) {
  const host = new URL(url).hostname
  return ({ 'github.com': 'GitHub', 'huggingface.co': 'Hugging Face', 'modelscope.cn': 'ModelScope', 'registry.npmmirror.com': '阿里 npmmirror', 'modelscope-open.oss-cn-hangzhou.aliyuncs.com': 'ModelScope 阿里云 OSS' } as Record<string, string>)[host] || host
}
export async function fileSize(path: string): Promise<number> {
  try { const info = await stat(path); return info.isFile() ? info.size : 0 }
  catch (error: any) { if (error.code === 'ENOENT') return 0; throw error }
}
export async function checksum(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export function downloadError(error: unknown, url: string): Error {
  const causes: string[] = []
  let current: unknown = error
  while (current instanceof Error) { causes.push(current.message); current = current.cause }
  return Object.assign(new Error(`下载失败：${url}\n${causes.join('\n')}`, { cause: error }), { code: 'DOWNLOAD_SOURCE_FAILED' })
}

/** Stream from the official source first, then try declared mirrors on download failure. */
export class DownloadClient {
  private agent = new Agent({ connect: { timeout: 10_000 }, headersTimeout: 15_000, bodyTimeout: 15_000 })
  close() { return this.agent.close() }
  async download(file: DownloadFile, target: string, signal: AbortSignal, progress: (bytes: number) => void, onSource?: (event: DownloadSourceEvent) => void) {
    signal.throwIfAborted()
    await mkdir(dirname(target), { recursive: true })
    const present = await fileSize(target)
    if (present) {
      if (present !== file.size || !(await checksum(target)).startsWith(file.sha256)) throw new Error(`文件校验失败：${target}。请移走该文件后重试。`)
      progress(present); return
    }
    const partial = target + '.part'
    let received = await fileSize(partial)
    if (received > file.size) throw new Error(`未完成文件超过预期大小：${partial}。请移走该文件后重试。`)
    progress(received)
    const urls = [...new Set([file.url, ...(file.mirrors || [])])]
    const failures: Error[] = []
    if (received < file.size) for (const [index, url] of urls.entries()) {
      try {
        onSource?.({ url, status: 'connecting' })
        received = await fileSize(partial)
        const response = await fetch(url, { dispatcher: this.agent, signal, headers: { 'Accept-Encoding': 'identity', ...(received ? { Range: `bytes=${received}-` } : {}) } }).catch(error => { throw downloadError(error, url) })
        if (!response.ok || !response.body) { await response.body?.cancel(); throw downloadError(new Error(`HTTP ${response.status}`), url) }
        if (received && (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${received}-`))) {
          await response.body.cancel()
          throw downloadError(new Error(`下载源未接受断点 ${received}，保留已下载文件：${partial}`), url)
        }
        onSource?.({ url, status: 'selected' })
        const output = await open(partial, received ? 'a' : 'w', 0o600)
        let writing = false
        try {
          for await (const chunk of response.body) {
            signal.throwIfAborted(); writing = true
            if (received + chunk.length > file.size) throw new Error(`下载内容超过清单大小：${url}`)
            let offset = 0
            while (offset < chunk.length) { const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset); offset += bytesWritten }
            received += chunk.length; progress(received); writing = false
          }
        } catch (error) { if (writing || signal.aborted) throw error; throw downloadError(error, url) }
        finally { await output.close() }
        if (received !== file.size) throw downloadError(new Error(`下载不完整 (${received}/${file.size})`), url)
        break
      } catch (error: any) {
        signal.throwIfAborted()
        if (error.code !== 'DOWNLOAD_SOURCE_FAILED') throw error
        onSource?.({ url, status: 'failed', error: error.message })
        failures.push(error)
        if (index === urls.length - 1) throw new AggregateError(failures, failures.map(error => error.message).join('\n'))
      }
    }
    signal.throwIfAborted()
    if (received !== file.size) throw new Error(`下载不完整：${target} (${received}/${file.size})`)
    if (!(await checksum(partial)).startsWith(file.sha256)) throw new Error(`下载校验失败：${partial}。请移走该文件后重试。`)
    signal.throwIfAborted()
    await rename(partial, target)
  }
}
