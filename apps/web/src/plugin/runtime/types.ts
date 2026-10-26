/** Browser services expose snapshots and explicit actions without a rendering dependency. */
export interface Observable<T> { subscribe(listener: () => void): () => void; getSnapshot(): T }
export type Request = <T>(path: string, init?: RequestInit) => Promise<T>
