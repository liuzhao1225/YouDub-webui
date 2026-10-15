import { Context, Service } from 'cordis'
import type { SlotMap, Slots } from '../sdk'

export class SlotsService extends Service implements Slots {
  private entries = new Map<keyof SlotMap, Map<string, SlotMap[keyof SlotMap]>>()
  private listeners = new Set<() => void>()
  private revision = 0
  constructor(ctx: Context) { super(ctx, 'slots') }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.revision
  private changed() { this.revision++; for (const listener of this.listeners) listener() }
  register<K extends keyof SlotMap>(slot: K, entry: SlotMap[K]) {
    const entries = this.entries.get(slot) ?? new Map()
    if (!entry.id || entries.has(entry.id) || (slot === 'root' && entries.size)) throw new Error(`Duplicate slot registration: ${slot}/${entry.id}`)
    if (slot === 'shell.routes') {
      const route = entry as SlotMap['shell.routes']
      if (!/^\/(?:[A-Za-z0-9_-]+|:[A-Za-z][A-Za-z0-9_]*|\/)*$/.test(route.path) || route.path.startsWith('/api') || route.path.startsWith('/_next')) throw new Error(`Unsupported plugin route: ${route.path}`)
      const shape = route.path.replace(/:[^/]+/g, ':')
      if ([...entries.values()].some((value) => (value as SlotMap['shell.routes']).path.replace(/:[^/]+/g, ':') === shape)) throw new Error(`Conflicting plugin route: ${route.path}`)
    }
    entries.set(entry.id, entry); this.entries.set(slot, entries); this.changed()
    return () => { entries.delete(entry.id); this.changed() }
  }
  list<K extends keyof SlotMap>(slot: K): SlotMap[K][] {
    return [...(this.entries.get(slot)?.values() ?? [])].sort((a, b) => (('order' in a ? a.order : 0) ?? 0) - (('order' in b ? b.order : 0) ?? 0)) as SlotMap[K][]
  }
}
export const name = 'client-slots'
export function apply(ctx: Context) { new SlotsService(ctx) }
