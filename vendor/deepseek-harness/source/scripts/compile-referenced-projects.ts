/** Ordered compilation for the maintained YouDub framework subset. */
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { pnpmCommand } from './release/process.ts'

type BuildStep = { label: string; command: string; args: string[] }

function compilerStep(root: string, face: 'host' | 'client'): BuildStep {
  const config = ts.getParsedCommandLineOfConfigFile(resolve(root, `tsconfig.${face}.json`), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    },
  })
  if (!config || !config.projectReferences?.length || config.options.noEmit !== true) {
    throw new Error(`Invalid framework build references: tsconfig.${face}.json`)
  }
  if (config.errors.length) throw new Error(config.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  return { label: `${face} compiler`, command: process.execPath, args: [
    ...face === 'host' ? ['--max-old-space-size=4096'] : [],
    fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-b',
    ...config.projectReferences.map(reference => relative(root, reference.path)),
  ] }
}

export function libraryBuildSteps(root: string): BuildStep[] {
  const [command, ...prefix] = pnpmCommand()
  const bundle = (face: string): BuildStep => ({ label: `${face} bundle`, command,
    args: [...prefix, 'exec', 'tsdown', '--config-loader', 'native', '--env.DSH_BUILD_FACE', face] })
  return [
    compilerStep(root, 'host'), bundle('host'),
    { label: 'Desktop bundle', command, args: [...prefix, '--filter', '@deepseek-ai/dsh-desktop', 'run', 'bundle'] },
    compilerStep(root, 'client'), bundle('client'),
    ...['host', 'client'].map(face => ({ label: `${face} test and script types`, command: process.execPath,
      args: [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', `tsconfig.${face}.json`, '--noEmit'] })),
  ]
}
