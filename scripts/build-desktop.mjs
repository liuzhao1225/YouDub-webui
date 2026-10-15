if (process.platform === 'darwin' && process.arch === 'arm64') await import('./build-mac.mjs')
else if (process.platform === 'win32' && process.arch === 'x64') await import('./build-windows.mjs')
else throw new Error(`Unsupported desktop build target: ${process.platform}-${process.arch}`)
