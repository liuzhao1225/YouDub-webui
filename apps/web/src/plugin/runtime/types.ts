/** Browser services expose snapshots and explicit actions without a rendering dependency. */
export interface Observable<T> { subscribe(listener: () => void): () => void; getSnapshot(): T }
export type Request = <T>(path: string, init?: RequestInit) => Promise<T>
export interface ApiClient { request: Request; setCsrf(token: string): void; clearSession(): void; abortReads(): void }
export interface Navigation extends Observable<string> {
  push(path: string): void; replace(path: string): void; href(routeId: string, params?: Record<string, string>): string
  block?(handler: (path: string) => Promise<boolean>): () => void
}
export type SessionSnapshot = { status: 'loading' | 'anonymous' | 'authenticated' | 'error'; error?: string }
export interface Session extends Observable<SessionSnapshot> { expire(): Promise<void> }
