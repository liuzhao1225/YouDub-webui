// The launcher attaches Node to its kill-on-close Job Object before releasing it.
let started = false
process.stdin.once('data', async () => {
  started = true
  try { await import('../server.mjs') }
  catch (error) { console.error(error); process.exit(1) }
})
process.stdin.once('end', () => { if (!started) process.exit(0) })
process.stdin.resume()
