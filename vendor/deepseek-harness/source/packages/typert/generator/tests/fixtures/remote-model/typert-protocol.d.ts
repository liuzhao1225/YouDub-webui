declare module '@deepseek-ai/dsh-typert-protocol' {
  export interface TypertLookup<Host, Wire> {
    readonly host: Host
    readonly wire: Wire
  }

  export interface TypertContext<Wire> {
    readonly wire: Wire
  }

  export interface TypertLookupMap {}
  export interface TypertContextMap {}
  export interface TypertRemoteMap {}
  export interface TypertRemoteScopeMap {}

  export interface RemoteFailure {
    readonly code: string
    readonly message: string
    readonly details: object
  }

  export type RemoteResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: RemoteFailure }

  export type RemoteDecoded<Value> = Value extends Uint8Array ? Uint8Array<ArrayBuffer>
    : Value extends string | number | boolean | bigint | symbol ? Value
      : Value extends object ? { [Key in keyof Value]: RemoteDecoded<Value[Key]> } : Value

  export type TypertRemoteNamespace<Namespace extends string> = {
    [Endpoint in keyof TypertRemoteMap as Endpoint extends `${Namespace}/${infer Method}`
      ? Method
      : never]: TypertRemoteMap[Endpoint]
  }

  export interface TypertRemoteNamespaceMap {}
  export interface TypertClientRemote extends TypertRemoteNamespaceMap {}

  export interface TypertRemoteValue<Value = unknown> {
    readonly create: () => { parse(value: unknown): Value }
    readonly description?: string
  }

  export type TypertCodec<Value = unknown> =
    | TypertRemoteValue<Value> & {
      readonly mode: 'strict'
      readonly typeSymbol: string
      readonly decode?: (value: unknown) => unknown
      readonly encode?: (value: unknown, writeBytes: (bytes: Uint8Array, path: readonly (string | number)[]) => null) => unknown
    }
    | { readonly mode: 'src-json' }

  export interface InvocationParameterDescriptor {
    readonly name: string
    readonly wire: string
    readonly source: 'json' | 'lookup'
    readonly lookup?: string
    readonly acceptsUndefined?: true
    readonly description?: string
    readonly codec: TypertCodec
  }

  export interface InvocationDescriptor {
    readonly id: string
    readonly service: string
    readonly namespace: string
    readonly method: string
    readonly implementation?: string
    readonly mode?: 'stream'
    readonly invocation:
      | { readonly kind: 'direct' }
      | { readonly kind: 'context'; readonly context: string; readonly wire: string; readonly codec: TypertCodec }
    readonly scope?: { readonly context: string; readonly wire: string }
    readonly parameters: readonly InvocationParameterDescriptor[]
    readonly uplink?: { readonly codec: TypertCodec }
    readonly cancellation?: { readonly parameter: 'signal' }
    readonly result: TypertCodec
    readonly description?: string
    readonly sourceLocation?: { readonly file: string; readonly line: number; readonly column: number }
  }

  export interface TypertRemoteContribution {
    readonly package: string
    readonly descriptors: readonly InvocationDescriptor[]
  }

  export type TypertRemoteInfo = TypertRemoteContribution

  export type RemoteStream<Out, In = never> = AsyncIterable<Out> & { readonly uplinkItem?: In }

  export interface RemoteStreamHandle<Out, In> extends AsyncIterable<Out> {
    send(item: In): void
    end(): void
    dispose(): void
  }

  export abstract class TypertRemoteService {
    readonly typertRemote: {
      readonly service: TypertRemoteService
      readonly serviceKey: string
      readonly namespace: string
    }
    protected constructor(
      ctx: unknown,
      serviceKey: string,
      options?: { readonly namespace?: string },
    )
  }

  export function bindTypertRemote<Service extends object>(
    service: Service,
    serviceKey: string,
    options?: { readonly namespace?: string },
  ): { readonly service: Service; readonly serviceKey: string; readonly namespace: string }

  export function Remote<This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void

  export function Remote(option: string | { readonly mode?: 'stream'; readonly name?: string; readonly resources?: object }):
  <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void

  export function RemoteScope(
    key: Extract<keyof TypertContextMap, string>,
    option?: string | { readonly name?: string; readonly resources?: object },
  ):
  <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void
}
