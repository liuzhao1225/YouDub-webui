import { performance } from 'node:perf_hooks'
import { Deque } from '../src/index.ts'

const sizes = [250_000, 500_000, 1_000_000, 2_000_000]
const samples = 5

function drain(size: number): { readonly milliseconds: number; readonly checksum: number } {
  const deque = new Deque<number>()
  for (let value = 0; value < size; value += 1) deque.pushBack(value)
  const started = performance.now()
  let checksum = 0
  while (deque.size > 0) checksum += deque.popFront() as number
  return { milliseconds: performance.now() - started, checksum }
}

function median(values: readonly number[]): number {
  const ordered = values.toSorted((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] as number
}

drain(sizes[0] as number)
for (const size of sizes) {
  const expected = size * (size - 1) / 2
  const durations: number[] = []
  for (let sample = 0; sample < samples; sample += 1) {
    const result = drain(size)
    if (result.checksum !== expected) throw new Error(`invalid checksum for ${String(size)} entries`)
    durations.push(result.milliseconds)
  }
  const milliseconds = median(durations)
  console.log(JSON.stringify({
    size,
    medianMilliseconds: Number(milliseconds.toFixed(3)),
    nanosecondsPerEntry: Number((milliseconds * 1_000_000 / size).toFixed(3)),
  }))
}
