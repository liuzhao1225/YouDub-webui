/** Generic keyless ACP v1 automation-control conformance over the real dsh profile. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-session-snapshot'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const agent: AgentUnderTest = {
  binScript: join(repoRoot, 'apps/cli/src/bin.ts'),
  libBinScript: join(repoRoot, 'apps/cli/lib/bin.js'),
  configPath: fileURLToPath(new URL('./fixtures/control-surface/cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: join(repoRoot, 'tsconfig.json'),
}
const mcpServer = fileURLToPath(new URL('../../../../../../packages/mcp/mcp-client/tests/fixture-server.ts', import.meta.url))

/** Find one named select value in grouped or ungrouped standard options. */
function selectValue(
  options: Awaited<ReturnType<LaunchedAcpTestAgent['client']['newSession']>>['configOptions'],
  configId: string,
  name: string,
): string {
  const option = options?.find(candidate => candidate.id === configId)
  if (option?.type !== 'select') throw new Error(`missing select option: ${configId}`)
  const values = option.options.flatMap(candidate => 'group' in candidate ? candidate.options : [candidate])
  const selected = values.find(candidate => candidate.name === name)
  if (selected === undefined) throw new Error(`missing ${configId} value: ${name}`)
  return selected.value
}

describe('standard ACP v1 control surface', () => {
  it('selects, mounts MCP, closes, restarts, resumes, and cancels through the SDK only', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-acp-control-'))
    const persistenceRoot = join(cwd, '.sessions')
    const env = { DSH_CONFORMANCE_PERSISTENCE_ROOT: persistenceRoot, DSH_TELEMETRY_DISABLED: '1' }
    const mcpServers = [{ name: 'fixture', command: process.execPath, args: [mcpServer], env: [] }]
    let first: LaunchedAcpTestAgent | undefined
    let second: LaunchedAcpTestAgent | undefined
    try {
      first = launchAcpTestAgent({ agent, cwd, env })
      await first.spawned
      const initialized = await first.client.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { _meta: { ignored: true } },
      })
      expect(initialized.agentCapabilities).toEqual({
        mcpCapabilities: { http: true },
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        sessionCapabilities: { close: {}, list: {}, resume: {} },
      })
      expect('_meta' in initialized).toBe(false)
      const created = await first.client.newSession({ cwd, mcpServers })
      const beta = selectValue(created.configOptions, 'model', 'Beta')
      const selectedModel = await first.client.setSessionConfigOption({
        sessionId: created.sessionId,
        configId: 'model',
        value: beta,
      })
      const low = selectValue(selectedModel.configOptions, 'reasoning_effort', 'Low')
      await first.client.setSessionConfigOption({
        sessionId: created.sessionId,
        configId: 'reasoning_effort',
        value: low,
      })

      await expect(first.client.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'exercise the attached server' }],
      })).resolves.toEqual({ stopReason: 'end_turn' })
      expect(first.updates.map(update => update.sessionUpdate)).toEqual([
        'agent_thought_chunk',
        'usage_update',
        'tool_call',
        'tool_call_update',
        'agent_message_chunk',
        'usage_update',
      ])
      expect(first.updates).toContainEqual(expect.objectContaining({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'model=beta; tool=5' },
      }))
      const message = first.updates.find(update => update.sessionUpdate === 'agent_message_chunk')
      expect(message !== undefined && 'messageId' in message && typeof message.messageId === 'string').toBe(true)
      await first.client.closeSession({ sessionId: created.sessionId })
      await first.close()
      first = undefined

      second = launchAcpTestAgent({ agent, cwd, env })
      await second.spawned
      await second.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      await expect(second.client.listSessions({ cwd })).resolves.toEqual({
        sessions: [{ sessionId: created.sessionId, cwd }],
      })
      await second.client.resumeSession({ sessionId: created.sessionId, cwd, mcpServers })
      const toolFinished = second.waitForUpdate(update => (
        update.sessionUpdate === 'tool_call_update' && update.toolCallId === 'control-cancel-add'
      ))
      const prompt = second.client.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'cancel after the tool finishes' }],
      })
      await toolFinished
      await second.client.cancel({ sessionId: created.sessionId })
      await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
      await second.client.closeSession({ sessionId: created.sessionId })
    } finally {
      await Promise.allSettled([first?.close(), second?.close()].filter((value): value is Promise<void> => value !== undefined))
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)
})
