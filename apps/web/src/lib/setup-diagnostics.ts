import type { SetupState } from '@/runtime/setup-contracts'

const phases = { installation: '安装设置', environment: '环境准备', models: '模型准备', starting: '启动工作台', ready: '已就绪', failed: '准备失败' }
const statuses = { pending: '等待中', running: '准备中', downloading: '下载中', paused: '已暂停', ready: '已就绪', failed: '失败' }

// Only the explicit fields below enter a report; never serialize private configuration.
export function redactDiagnostics(text: string, homeDir?: string) {
  if (homeDir) text = text.replaceAll(homeDir, '[HOME]').replaceAll(homeDir.replaceAll('\\', '/'), '[HOME]')
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, raw => raw
      .replace(/^(https?:\/\/)[^/]+@/i, '$1[REDACTED]@')
      .replace(/[?#].*$/, '?[REDACTED]'))
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:[\w-]*(?:api[_-]?key|token|password|secret)|authorization)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(?:[A-Z]:[\\/]Users[\\/]|\/(?:Users|home)\/)[^\\/\r\n]+/gi, '[HOME]')
}

export function setupReport(state?: SetupState | null, requestError = '') {
  if (state?.resources) {
    const resource = state.resources
    state = { ...state, resources: undefined,
      phase: resource.status === 'failed' ? 'failed' : resource.status === 'preparing' || resource.status === 'missing' ? 'models' : state.phase,
      environment: resource.environment.length ? resource.environment : state.environment,
      models: resource.models, error: [state.error, resource.error].filter(Boolean).join('\n') || undefined }
  }
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
      ...(step.activity && step.activity !== step.detail && !step.log?.includes(step.activity) ? [step.activity] : []),
    )
    lines.push('', '模型准备:')
    for (const model of state.models) lines.push(
      `[${model.status === 'ready' ? '文件已齐' : statuses[model.status]}] ${model.name} ${model.variant} | ${model.received}/${model.total} bytes${model.source ? ` | ${model.source}` : ''}`,
    )
  }
  const errors: string[] = []
  if (requestError) errors.push('连接错误:', requestError)
  if (state?.error) errors.push('准备错误:', state.error)
  for (const step of state?.environment || []) {
    if (step.status === 'failed' && step.detail && step.detail !== state?.error) errors.push(`${step.name} 错误:`, step.detail)
  }
  for (const model of state?.models || []) if (model.error) errors.push(`${model.name} 错误:`, model.error)
  const logs = [...(state?.environment || []), ...(state?.models || [])].filter(item => item.log)
  if (logs.length) { lines.push('', '下载与安装日志:'); for (const item of logs) lines.push(`[${item.name}]`, item.log!) }
  if (errors.length) lines.push('', '错误日志:', ...errors)
  return redactDiagnostics(lines.join('\n'), state?.homeDir)
}

function codeBlock(text: string) {
  const longest = [...text.matchAll(/`+/g)].reduce((length, match) => Math.max(length, match[0].length), 2)
  const fence = '`'.repeat(longest + 1)
  return `${fence}text\n${text}\n${fence}`
}

const issueIntro = '### 问题描述\n\n请描述遇到的问题。\n\n### 复现步骤\n\n1. \n2. \n\n### 预期结果\n\n\n\n### 实际结果\n\n\n\n### 基础信息\n\n'
const issueLogs = '### 日志或截图（可选）\n\n请补充相关日志或截图，并移除 API Key、Token、密码等敏感信息。'
function newIssue(template: 'setup-problem.md' | 'bug-report.md', title: string, body: string) {
  return { url: `https://github.com/liuzhao1225/YouDub-webui/issues/new?${new URLSearchParams({ template, title, body })}` }
}

export interface FeedbackInfo {
  version?: string; platform?: string; arch?: string; osVersion?: string
  page?: string; language?: string; theme?: string; userAgent?: string
}

export function feedbackIssue(info: FeedbackInfo) {
  const platform = ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[info.platform ?? ''] ?? info.platform
  const theme = ({ system: '自动（跟随系统）', light: '浅色', dark: '深色' } as Record<string, string>)[info.theme ?? ''] ?? info.theme
  const details = redactDiagnostics([
    `YouDub: ${info.version || '未知'}`,
    `系统: ${platform || '未知'}${info.osVersion ? ` / ${info.osVersion}` : ''}`,
    `架构: ${info.arch || '未知'}`,
    `页面: ${info.page?.split(/[?#]/, 1)[0] || '未知'}`,
    `语言: ${info.language || '未知'}`,
    `主题: ${theme || '未知'}`,
    `客户端: ${info.userAgent || '未知'}`,
  ].join('\n'))
  return newIssue('bug-report.md', '[问题反馈] ', issueIntro + codeBlock(details) + '\n\n' + issueLogs)
}

export function setupIssue(report: string, state?: SetupState | null) {
  const title = `[环境配置] ${state ? phases[state.phase] : '连接准备服务'}`
  const intro = '### 问题描述\n\n请描述环境配置过程中遇到的问题及出错前的操作。\n\n### 环境信息\n\n'
  const logs = '### 诊断日志\n\n请粘贴环境配置页「复制日志」得到的完整诊断日志，并补充相关截图（如有）。'
  return newIssue('setup-problem.md', title, intro + codeBlock(report.split('\n').slice(0, 3).join('\n')) + '\n\n' + logs)
}
