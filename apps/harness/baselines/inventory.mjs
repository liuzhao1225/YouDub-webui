import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const here = fileURLToPath(new URL('.', import.meta.url))
const sourceSnapshot = 'f6f927903581b165f2bf6c840ea65b896d319524'
const args = process.argv.slice(2)
const write = args.includes('--write')
const arg = (name, value) => args.includes(name) ? args[args.indexOf(name) + 1] : value
const repository = resolve(arg('--repo', root))
const ref = arg('--ref', sourceSnapshot)
const git = (...args) => execFileSync('git', ['-C', repository, ...args], {encoding:'utf8', maxBuffer:32 * 1024 * 1024})
const files = git('ls-tree', '-r', '--name-only', ref).trim().split('\n')
const read = path => git('show', `${ref}:${path}`)
const line = (text, index) => text.slice(0, index).split('\n').length
const apiRoutes = []
for (const path of files.filter(path => /^packages\/builtin\/src\/.*\.ts$/.test(path))) {
  const content = read(path)
  const methods = /(?:\broute|\bhttp\.register)\(\s*['"](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"]\s*,\s*(['"`])([^'"`]+)\2/g
  for (const match of content.matchAll(methods)) {
    let url = match[3].replaceAll('${base}', '/api/v2')
    const prefix = path.endsWith('/llm-models-api.ts') ? '/api/v2/models' : ''
    let urls = [url]
    if (url.includes('${action}')) {
      const loops = [...content.slice(0, match.index).matchAll(/for \(const action of \[([^\]]+)\]/g)]
      if (!loops.length) throw new Error(`Unresolved route action: ${path}:${line(content, match.index)}`)
      const values = [...loops.at(-1)[1].matchAll(/['"]([^'"]+)['"]/g)].map(value => value[1])
      urls = values.map(action => url.replace('${action}', action))
    }
    for (const url of urls) {
      if (url.includes('${')) throw new Error(`Unresolved dynamic API path: ${path}:${line(content, match.index)}`)
      apiRoutes.push({ method:match[1], path:prefix+url, source:path, line:line(content, match.index) })
    }
  }
}
const pages = []
for (const path of files.filter(path => /^apps\/web\/src\/.*\.tsx$/.test(path) && !path.includes('.test.'))) {
  const content = read(path)
  for (const match of content.matchAll(/slots\.register\('shell\.routes',\s*\{\s*id:\s*'([^']+)',\s*path:\s*'([^']+)'/g)) {
    pages.push({ id:match[1], path:match[2], source:path, line:line(content, match.index) })
  }
}
const operationSource = 'packages/builtin/src/media-contracts.ts'
const operationText = read(operationSource)
const operations = [...operationText.matchAll(/^  (\w+): \{ id: '([^']+)'[^\n]+/gm)].map(match => ({
  key:match[1], id:match[2], source:operationSource, line:line(operationText, match.index),
  outputs:[...match[0].slice(match[0].indexOf('outputs:')).matchAll(/(artifact|json)\('([^']+)', '([^']+)'/g)].map(output => ({ kind:output[1], name:output[2], schemaId:output[3] })),
}))
const workflowSources = files.filter(path => /^packages\/builtin\/src\/workflow-templates\/.*\.json$/.test(path))
const workflows = workflowSources.map(path => { const value = JSON.parse(read(path)); return {id:value.id, label:value.label ?? value.name, source:path, nodes:value.nodes.map(node => ({id:node.id,type:node.type,provider:node.provider,autoContinue:node.autoContinue}))} })
const elements = files.filter(path => /^apps\/web\/src\/(components|plugin\/builtin)\/.*\.tsx$/.test(path) && !path.includes('.test.')).map(path => ({source:path, exports:[...read(path).matchAll(/(?:export\s+)?function\s+([A-Z]\w*)\s*\(/g)].map(match=>match[1])}))
const workerOperations = [...read('backend/workers/operations.py').matchAll(/"([\w.]+\/v\d+)": self\.(\w+)/g)].map(match => ({id:match[1],handler:match[2]}))
const manifest = { sourceSnapshot, sourceTree:git('rev-parse', `${ref}^{tree}`).trim(), apiRoutes, operations, workerOperations, pages, workflows, elements,
  interpretation:'Static inventory from the preserved YouDub source snapshot. Presence in this list is not proof of migrated implementation or end-to-end acceptance.' }
if (!apiRoutes.length || !operations.length || !pages.length) throw new Error('Source inventory is unexpectedly empty.')
const result = JSON.stringify(manifest, null, 2)+'\n'
const destination = resolve(arg('--output', `${here}/youdub-source-inventory.json`))
if (write) await writeFile(destination, result)
else if (result !== await readFile(destination, 'utf8')) throw new Error(`Inventory differs from ${ref}: regenerate and review explicitly.`)
console.log(JSON.stringify({verified:!write, sourceSnapshot, apiRoutes:apiRoutes.length, operations:operations.length, workerOperations:workerOperations.length, pages:pages.length, workflows:workflows.length, elementFiles:elements.length}))
