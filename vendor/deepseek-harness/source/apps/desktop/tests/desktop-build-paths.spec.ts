import { describe, expect, it } from 'vitest'
import { desktopTargetPlatform } from '../scripts/desktop-build-paths.mjs'

describe('desktop build target', () => {
  it('maps every target to the platform and architecture of the payload it prepares', () => {
    expect(desktopTargetPlatform('mac-arm64')).toEqual({ platform: 'darwin', arch: 'arm64' })
    expect(desktopTargetPlatform('mac-x64')).toEqual({ platform: 'darwin', arch: 'x64' })
    expect(desktopTargetPlatform('win-x64')).toEqual({ platform: 'win32', arch: 'x64' })
    expect(desktopTargetPlatform('linux-x64')).toEqual({ platform: 'linux', arch: 'x64' })
    expect(desktopTargetPlatform('linux-arm64')).toEqual({ platform: 'linux', arch: 'arm64' })
    expect(() => desktopTargetPlatform('freebsd-x64' as 'mac-x64')).toThrow(/unsupported target/u)
  })

})
