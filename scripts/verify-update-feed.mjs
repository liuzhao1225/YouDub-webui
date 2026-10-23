import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const expected = JSON.parse(await readFile(new URL('../site/releases.json', import.meta.url), 'utf8'))
const url = new URL('releases.json', process.argv[2])
url.searchParams.set('deployment', process.env.GITHUB_RUN_ID ?? Date.now().toString())
const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
if (!response.ok) throw new Error(`Published update feed returned HTTP ${response.status}: ${url}`)
assert.deepEqual(await response.json(), expected, 'Published update feed differs from the deployment artifact')
console.log(`Published update feed verified: ${expected.find(release => release.isLatest).version}`)
