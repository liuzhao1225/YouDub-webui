/** Vitest shares the workstation; CI uses its runner's reported CPU budget. */
import { availableParallelism } from 'node:os'

export function defaultTestParallelism(env: NodeJS.ProcessEnv = process.env): number {
  const available = availableParallelism()
  return env.CI === 'true' ? available : Math.min(available, 48)
}
