/** Test host for rendering a feature against its fixture services through the production binder. */
import { useMemo, type ComponentType } from 'react'
import { bindComponent, useClient, type ClientBindings } from './sdk'
export function bindTestComponent<P extends object, K extends keyof ClientBindings>(Component: ComponentType<P>, keys: readonly K[]) {
  return function TestComponent(props: Omit<P, K>) {
    const context = useClient()
    const Bound = useMemo(() => bindComponent(context, keys, Component), [context])
    return <Bound {...props} />
  }
}

export async function requireActive(fiber: import('cordis').Fiber, name: string) {
  await fiber
  if (fiber.state !== 2) throw new Error(`Plugin ${name} failed to activate (state ${fiber.state})`)
}
