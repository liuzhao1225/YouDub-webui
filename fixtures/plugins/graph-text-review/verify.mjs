import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Run against a local Host. No browser/session secrets are written to evidence.
const base = process.env.YOUDUB_VERIFY_BASE || 'http://127.0.0.1:8012'
const evidenceRoot = resolve(process.env.YOUDUB_VERIFY_OUTPUT || 'output/validation/graph-text-review')
const session = await fetch(`${base}/api/auth/session`)
assert.equal(session.status, 200)
const cookie = session.headers.get('set-cookie').split(';')[0]
const { csrf_token: csrf } = await session.json()
const headers = { Cookie: cookie, 'X-CSRF-Token': csrf }
async function request(path, body, status = 200) {
  const response = await fetch(`${base}${path}`, body === undefined ? { headers } :
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, status, JSON.stringify(value))
  return value
}
if (process.argv.includes('--install')) {
  const installed = await request('/api/v2/extensions/install', { source: fileURLToPath(new URL('./', import.meta.url)) }, 201)
  console.log(JSON.stringify({ id: installed.id, active: installed.active, next: 'Restart the Host, then run this script without --install.' }))
} else {
  await mkdir(evidenceRoot, { recursive: true })
  const record = await request('/api/v2/workflow-documents/example.text-review')
  assert.equal(record.origin, 'plugin')
  const document = record.document
  const types = (await request('/api/v2/node-types')).items.filter(type => type.providerId === 'example.graph-text')
  assert.equal(types.length, 3)
  const review = types.find(type => type.type === 'example.text-review')
  assert.equal(review.inputs.length, 2)
  assert.equal(review.outputs.length, 2)
  assert.equal(review.ui.detailId, 'example.text-review.details')
  const manifest = await request('/api/v2/client-manifest')
  const client = manifest.modules.find(module => module.id === 'example.graph-text-review')
  assert.ok(client, 'Installed client module must be present.')
  const asset = await fetch(new URL(client.url, base), { headers })
  assert.equal(asset.status, 200)
  assert.match(await asset.text(), /workflow\.node\.details/)
  const resources = await request('/api/v2/workflow-documents/resources/check', { document })
  assert.equal(resources.status, 'ready')
  const validation = await request('/api/v2/workflow-documents/validate', { document })
  assert.equal(validation.valid, true, JSON.stringify(validation))
  const id = randomUUID(), form = new FormData()
  form.append('request', JSON.stringify({ id, workflowId: 'youdub.graph', graphDocument: document, config: {} }))
  const createdResponse = await fetch(`${base}/api/v2/tasks`, { method: 'POST', headers, body: form })
  const created = await createdResponse.json()
  assert.equal(createdResponse.status, 201, JSON.stringify(created))
  async function waitFor(status) {
    for (let count = 0; count < 100; count++) {
      const task = await request(`/api/v2/tasks/${id}`)
      assert.ok(!['failed', 'cancelled'].includes(task.status), JSON.stringify(task))
      if (task.status === status) return task
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Task did not reach ${status}.`)
  }
  const paused = await waitFor('paused')
  assert.equal(paused.steps.find(step => step.id === 'review').status, 'awaiting_review')
  assert.equal(paused.steps.find(step => step.id === 'export').status, 'pending')
  assert.equal(paused.finishedAt, null)
  const initial = await request(`/api/v2/tasks/${id}/nodes/review`)
  assert.equal(initial.resultRevisions.length, 1)
  assert.equal(initial.inputs.left.text, 'Hello YouDub')
  assert.equal(initial.inputs.right.text, '第二段待校对内容')
  await writeFile(resolve(evidenceRoot, 'paused.json'), JSON.stringify({ task: paused, detail: initial, resources, types, client }, null, 2))
  if (process.argv.includes('--pause')) {
    console.log(JSON.stringify({ taskId: id, status: paused.status, nodeUrl: `${base}/tasks/${id}/nodes/review`, evidenceRoot }))
  } else {
    const command = detail => ({ actionId: randomUUID(), expectedAttempt: detail.attempt, expectedTaskRevision: detail.taskRevision, expectedOutputRevision: detail.outputRevision })
    const invalid = await request(`/api/v2/tasks/${id}/nodes/review/corrections`, { ...command(initial), patch: { text: { text: '   ' } } }, 422)
    assert.equal(invalid.error.code, 'INVALID_CORRECTION')
    const unchanged = await request(`/api/v2/tasks/${id}/nodes/review`)
    assert.equal(unchanged.outputRevision, initial.outputRevision)
    const correctedText = 'Hello YouDub\n插件页面校对后的最终内容'
    const saved = await request(`/api/v2/tasks/${id}/nodes/review/corrections`, { ...command(unchanged), patch: { text: { text: correctedText } }, continue: false })
    const corrected = await request(`/api/v2/tasks/${id}/nodes/review`)
    assert.equal(corrected.status, 'paused')
    assert.equal(corrected.resultRevisions.length, 2)
    assert.equal(corrected.resultRevisions[0].source, 'computed')
    assert.equal(corrected.resultRevisions[1].source, 'correction')
    assert.deepEqual(corrected.resultRevisions[1].outputs.metadata, { sources: 2 })
    await request(`/api/v2/tasks/${id}/nodes/review/approve`, command(corrected))
    const completed = await waitFor('succeeded')
    const response = await fetch(`${base}/api/v2/tasks/${id}/files/document`, { headers })
    assert.equal(response.status, 200)
    const output = await response.text()
    assert.equal(output, `${correctedText}\n\n来源数量：2\n`)
    await writeFile(resolve(evidenceRoot, 'reviewed.txt'), output)
    await writeFile(resolve(evidenceRoot, 'result.json'), JSON.stringify({ task: completed, initial, invalid, saved, corrected, resources, types, client }, null, 2))
    console.log(JSON.stringify({ taskId: id, status: completed.status, revisions: corrected.resultRevisions.length, evidenceRoot }))
  }
}
