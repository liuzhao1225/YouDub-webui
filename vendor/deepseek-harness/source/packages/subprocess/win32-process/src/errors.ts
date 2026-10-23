/** Win32 call failure with the exact API name and error code. */
export class Win32Error extends Error {
  /** Win32 function whose checked result failed. */
  readonly api: string
  /** Exact GetLastError value or direct Win32 API error code. */
  readonly win32Code: number

  constructor(api: string, win32Code: number, detail?: string) {
    super(`${api} failed (Win32 ${win32Code})${detail === undefined ? '' : `: ${detail}`}`)
    this.name = 'Win32Error'
    this.api = api
    this.win32Code = win32Code
  }
}
