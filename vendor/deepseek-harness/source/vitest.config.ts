import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'
import { LOCAL_TEST_PARALLELISM_CAP, defaultParallelism } from './scripts/parallelism.ts'
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    pool: 'forks', execArgv: vitestExecArgv,
    maxWorkers: defaultParallelism(process.env, undefined, LOCAL_TEST_PARALLELISM_CAP),
    setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-dom-environment.ts'],
    include: ['packages/*/*/tests/**/*.spec.{ts,tsx}', 'apps/*/tests/**/*.spec.{ts,tsx}', 'scripts/**/*.spec.ts'],
    exclude: process.platform === 'win32' ? [
      'packages/subprocess/subprocess/tests/**/*.spec.ts',
      'packages/subprocess/subprocess-local/tests/local.spec.ts',
      'packages/subprocess/subprocess-local/tests/process-inspector.spec.ts',
      'packages/subprocess/subprocess-local/tests/spawn.spec.ts',
    ] : [],
  },
})
