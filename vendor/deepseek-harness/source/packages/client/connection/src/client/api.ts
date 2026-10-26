/** Browser-safe Connection protocol and shared application value exports. */

export type {
  ClientRequest,
  RpcMessage,
  RpcRequest,
  RpcResponse,
  RpcResult,
  ServerResponse,
} from '../rpc.ts'
export { RpcId, transportError } from '../rpc.ts'
export type { MessageId } from '@deepseek-ai/dsh-llm/brand'
export type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm/types'
