/** Vitest shares the workstation; CI uses its runner's reported CPU budget. */
import { availableParallelism } from 'node:os'

export function defaultTestParallelism(): number {
  const available = availableParallelism()
  return process.env.CI === 'true' ? available : Math.min(available, 48)
}
