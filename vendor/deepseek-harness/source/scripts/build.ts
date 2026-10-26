/** Compile the maintained framework subset for YouDub. */
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { CLIENT_BUILD_RECORD_PATH, clientBuildProcessEnvironment, repositoryClientBuildEnvironment, writeClientBuildRecord } from './client-build-environment.ts'
import { libraryBuildSteps } from './compile-referenced-projects.ts'
import { pnpmCommand } from './release/process.ts'
const { values } = parseArgs({ options: { scope: { type: 'string', default: 'artifacts' } } })
if (values.scope !== 'artifacts') throw new Error('YouDub framework builds use --scope artifacts')
const root = resolve(import.meta.dirname, '..')
const clientEnvironment = repositoryClientBuildEnvironment(root, process.env)
const env = clientBuildProcessEnvironment(process.env, clientEnvironment)
rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
const [command, ...prefix] = pnpmCommand()
const steps = [...libraryBuildSteps(root), { label: 'Web build', command, args: [...prefix, 'run', 'build:web'] }]
for (const step of steps) {
  console.log('build: ' + step.label)
  const result = spawnSync(step.command, [...step.args], { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(step.label + ' failed: ' + String(result.status ?? result.signal))
}
const record = writeClientBuildRecord(root, clientEnvironment)
console.log('build: ' + steps.length + ' steps passed; ' + record.artifacts.fileCount + ' client artifacts')
