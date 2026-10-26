import { existsSync } from 'node:fs'
import { join } from 'node:path'
import runtimeManifest from './setup-runtime.json' with { type: 'json' }

/**
 * Windows 的 FFmpeg 压缩包会按命中的下载源解压成不同目录，安装器和运行时必须用同一个目录。
 * 返回包含 ffmpeg/ffprobe 的目录：Windows 为解压出的 bin，其他平台直接是 runtime/ffmpeg。
 */
export function ffmpegDirectory(root: string, platform = process.platform) {
  const directory = join(root, 'runtime', 'ffmpeg')
  if (platform !== 'win32') return directory
  const assets = runtimeManifest.ffmpeg['win32-x64']
  const installed = assets.find(asset => existsSync(join(directory, asset.directory, 'bin', 'ffmpeg.exe')))
  return join(directory, installed?.directory ?? assets[0]!.directory, 'bin')
}
