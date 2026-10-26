import type {LocalizedText} from './contracts'

export function text(value: LocalizedText | undefined, language = 'zh'): string {
  return typeof value === 'string' ? value : value?.translations?.[language] ?? value?.default ?? ''
}
export function matchRoute(path: string, pattern: string): Record<string, string> | null {
  const parts = path.split('/').filter(Boolean), tokens = pattern.split('/').filter(Boolean)
  if (parts.length !== tokens.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].startsWith(':')) {
      try { params[tokens[index].slice(1)] = decodeURIComponent(parts[index]) } catch { return null }
    } else if (tokens[index] !== parts[index]) return null
  }
  return params
}
export function resolveRoute<T extends { path: string; access?: 'public' | 'authenticated' }>(routes: T[], path: string, authenticated: boolean) {
  // Static segments take precedence over parameters, independently of plugin
  // installation order (for example /tasks/help before /tasks/:id).
  const specificity = (pattern: string) => pattern.split('/').map((part) => part.startsWith(':') ? '0' : '1').join('')
  return routes.map((route) => ({ route, params: matchRoute(path, route.path) }))
    .filter((item) => item.params && (item.route.access === 'public' || authenticated))
    .sort((a, b) => specificity(b.route.path).localeCompare(specificity(a.route.path)))[0]
}
