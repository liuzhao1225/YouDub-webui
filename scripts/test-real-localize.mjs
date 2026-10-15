// Opt-in end-to-end acceptance against a running app with configured providers.
// Uses actual models and the user's translation service. Never run in generic CI.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const [address, input, directory = '.cache/real-localize'] = process.argv.slice(2)
if (!address || !input) throw new Error('Usage: node scripts/test-real-localize.mjs http://127.0.0.1:PORT INPUT_VIDEO [EVIDENCE_DIR]')
const base = new URL(address)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Use the local application address.')
const output = resolve(directory)
await mkdir(output, { recursive: true })
const session = await fetch(new URL('/api/auth/session', base))
if (!session.ok) throw new Error(`Session HTTP ${session.status}`)
const auth = await session.json()
const headers = { Cookie: session.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; '), 'X-CSRF-Token': auth.csrf_token }
async function json(path, options = {}) {
  const response = await fetch(new URL(path, base), { ...options, headers: { ...headers, ...options.headers } })
  const value = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`)
  return value
}
const runtime = await json('/api/v2/runtime')
const settings = await json('/api/v2/settings')
const select = capability => {
  const provider = runtime.capabilities.find(item => item.capability === capability && item.available)
  const configured = settings.defaults?.[capability]?.model
  const model = provider?.models.find(item => item.id === configured) || provider?.models[0]
  if (!model) throw new Error(`No available ${capability} model; finish application setup first.`)
  return { adapter: provider.adapter, model: model.id, device: model.devices[0] }
}
const config = {
  source_language: 'en', target_language: 'zh', output_mode: 'both', keep_background: true,
  asr: select('asr'), translation: select('translation'),
  tts: { ...select('tts'), voice: { mode: 'source_clone' } }, separation: select('separation'),
  subtitle_alignment: select('subtitle_alignment'),
}
const id = randomUUID()
const form = new FormData()
form.append('request', JSON.stringify({ id, workflowId: 'youdub.localize', config }))
form.append('input.video', new Blob([await readFile(input)], { type: 'video/mp4' }), basename(input))
const startedAt = new Date().toISOString()
let task = await json('/api/v2/tasks', { method: 'POST', body: form })
await writeFile(join(output, 'task-id.txt'), id)
console.log(`Task ${id} submitted; devices: ${JSON.stringify(Object.fromEntries(['asr', 'tts', 'separation', 'subtitle_alignment'].map(kind => [kind, config[kind].device])))}`)
const deadline = Date.now() + 30 * 60_000
let lastState
while (true) {
  const state = JSON.stringify({ status: task.status, steps: task.steps })
  if (state !== lastState) { console.log(state); lastState = state }
  await writeFile(join(output, 'result.json'), JSON.stringify({ startedAt, observedAt: new Date().toISOString(), devices: runtime.devices, task }, null, 2))
  if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.status)) break
  if (Date.now() > deadline) throw new Error(`Task ${id} is still active after 30 minutes; inspect it in the app.`)
  await delay(10_000)
  task = await json(`/api/v2/tasks/${id}`)
}
if (task.status !== 'succeeded') {
  const response = await fetch(new URL(`/api/v2/tasks/${id}/log?lines=200`, base), { headers })
  await writeFile(join(output, 'task.log'), await response.text())
  throw new Error(`Task ${id} ended with ${task.status}; inspect ${join(output, 'task.log')}`)
}
for (const artifact of task.outputs) {
  const response = await fetch(new URL(artifact.url, base), { headers })
  if (!response.ok) throw new Error(`Download ${artifact.id} HTTP ${response.status}`)
  const name = basename(artifact.name || artifact.id)
  await writeFile(join(output, name), Buffer.from(await response.arrayBuffer()))
  console.log(`Saved ${name}`)
}
console.log(`Task ${id} completed. Evidence: ${output}`)
