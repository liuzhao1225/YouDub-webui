/** Generated Remote contribution registered and withdrawn with its plugin. */
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
export type TypertFace = 'host' | 'client'
export interface TypertContribution {
  readonly package: string
  readonly face: TypertFace
  readonly invocations: readonly InvocationDescriptor[]
}
