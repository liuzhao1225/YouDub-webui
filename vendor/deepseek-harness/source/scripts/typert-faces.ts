/**
 * Program faces of the repository's Typert pass. The Host face alone emits
 * Host contracts and the Host-for-Client Remote projection. The Host tsdown plugin (`tsdown.config.ts`)
 * generates exactly these
 * faces. Node loads this module through type stripping from
 * `tsdown.config.ts`, so it uses only erasable TypeScript syntax.
 */
export const WORKSPACE_TYPERT_FACES = ['host'] as const
