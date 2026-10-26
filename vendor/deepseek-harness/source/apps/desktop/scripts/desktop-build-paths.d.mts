/** Supported platform and architecture for the Electron framework runtime. */
export type DesktopBuildTarget = 'mac-arm64' | 'mac-x64' | 'win-x64' | 'linux-arm64' | 'linux-x64'

/**
 * Return the platform and architecture of the payload one release target prepares.
 * Windows is prepared as x64 only, so this differs from the build host on an arm64 Windows machine.
 * @param target - Supported Desktop target name.
 * @returns Platform and architecture of the prepared payload.
 */
export function desktopTargetPlatform(target: DesktopBuildTarget): {
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly arch: 'arm64' | 'x64'
}
