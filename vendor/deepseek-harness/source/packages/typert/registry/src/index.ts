/** Host entry for the shared Typert runtime registry. */
import type { TypertDisposer } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from './types.ts'
export { default, TypertRegistry, typertEndpoint } from './service.ts'
export type * from './types.ts'
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRegistryContract {
    register(contribution: TypertContribution): TypertDisposer
  }
}
