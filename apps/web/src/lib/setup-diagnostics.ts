import type { SetupState } from '@/components/setup-screen'

const phases = { environment: '环境准备', models: '模型准备', starting: '启动工作台', ready: '已就绪', failed: '准备失败' }
const statuses = { pending: '等待中', running: '准备中', downloading: '下载中', paused: '已暂停', ready: '已就绪', failed: '失败' }

// Only the explicit fields below enter a report; never serialize the setup token or configuration.
export function redactDiagnostics(text: string, token?: string) {
  if (token) text = text.replaceAll(token, '[REDACTED]')
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, raw => raw
      .replace(/^(https?:\/\/)[^/]+@/i, '$1[REDACTED]@')
      .replace(/[?#].*$/, '?[REDACTED]'))
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:[\w-]*(?:api[_-]?key|token|password|secret)|authorization)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(?:[A-Z]:[\\/]Users[\\/]|\/(?:Users|home)\/)[^\\/\r\n]+/gi, '[HOME]')
}

export function setupReport(state?: SetupState | null, requestError = '') {
  const lines = [
    `YouDub: ${state?.version || '未知（尚未取得版本）'}`,
    `系统: ${state ? `${state.platform} ${state.arch}${state.osVersion ? ` / ${state.osVersion}` : ''}` : '未知（尚未连接服务）'}`,
    `阶段: ${state ? phases[state.phase] : '连接准备服务'}`,
  ]
  if (state) {
    lines.push('', '环境准备:')
    for (const step of state.environment) lines.push(
      `[${statuses[step.status]}] ${step.name}${step.source ? ` | ${step.source}` : ''}`,
      ...(step.detail && step.status !== 'failed' && step.detail !== state.error ? [step.detail] : []),
    )
    lines.push('', '模型准备:')
    for (const model of state.models) lines.push(
      `[${statuses[model.status]}] ${model.name} ${model.variant} | ${model.received}/${model.total} bytes${model.source ? ` | ${model.source}` : ''}`,
    )
  }
  const errors: string[] = []
  if (requestError) errors.push('连接错误:', requestError)
  if (state?.error) errors.push('准备错误:', state.error)
  for (const step of state?.environment || []) {
    if (step.status === 'failed' && step.detail && step.detail !== state?.error) errors.push(`${step.name} 错误:`, step.detail)
  }
  for (const model of state?.models || []) if (model.error) errors.push(`${model.name} 错误:`, model.error)
  if (errors.length) lines.push('', '错误日志:', ...errors)
  return redactDiagnostics(lines.join('\n'), state?.token)
}

function codeBlock(text: string) {
  const longest = [...text.matchAll(/`+/g)].reduce((length, match) => Math.max(length, match[0].length), 2)
  const fence = '`'.repeat(longest + 1)
  return `${fence}text\n${text}\n${fence}`
}

export function setupIssue(report: string, state?: SetupState | null) {
  const title = `[准备问题] ${state ? phases[state.phase] : '连接准备服务'}`
  const intro = '### 问题描述\n\n请补充出错前的操作、是否每次出现。\n\n### 诊断日志\n\n'
  const url = (body: string) => `https://github.com/liuzhao1225/YouDub-webui/issues/new?${new URLSearchParams({ template: 'setup-problem.md', title, body })}`
  return { url: url(intro + codeBlock(report.split('\n').slice(0, 3).join('\n')) + '\n\n请在这里粘贴从准备页复制的完整诊断日志。') }
}
