import z from '@deepseek-ai/schemastery'
import { WebhookRuleId } from '@deepseek-ai/dsh-webhook'

export const name = 'github-webhook-real-e2e-rule'
export const inject = ['webhookRuntime']

export const Config = z.object({
  source: z.string().required(),
  repository: z.string().required(),
  workspacePath: z.string().required(),
  marker: z.string().required(),
  agentPreset: z.string().required(),
  permissionPreset: z.string().required(),
})

export function apply(ctx, config) {
  ctx.effect(() => ctx.webhookRuntime.register({
    id: WebhookRuleId('github-real-e2e'),
    kind: 'github',

    run(delivery, signal) {
      if (delivery.source !== config.source) return null
      if (delivery.event.name !== 'pull_request') return null
      const { payload } = delivery.event
      if (payload.action !== 'ready_for_review') return null
      if (payload.repository?.full_name !== config.repository) return null
      signal.throwIfAborted()

      return {
        workspacePath: config.workspacePath,
        title: 'GitHub webhook real e2e',
        prompt: `Reply with exactly ${config.marker} and no other text. Do not call tools.`,
        agentPreset: config.agentPreset,
        permissionPreset: config.permissionPreset,
      }
    },
  }))
}
