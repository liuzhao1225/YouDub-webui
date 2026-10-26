import { describe, expect, it } from 'vitest'
import type { SetupState } from '@/components/setup-screen'
import { feedbackIssue, redactDiagnostics, setupIssue, setupReport } from './setup-diagnostics'
import { resourceSetupState } from '@/runtime/setup-contracts'

const state: SetupState = {
  version: '0.0.6', platform: 'win32', arch: 'x64', osVersion: '10.0.26100', phase: 'failed', canRetry: true,
  error: 'Python exited (1).\nTraceback:\nModuleNotFoundError: torch',
  environment: [{ id: 'dependencies', name: '运行依赖', status: 'failed', source: '阿里 PyPI', detail: 'No matching distribution found' }],
  models: [{ id: 'qwen', name: 'Qwen3 Aligner', variant: '0.6B', purpose: '字幕对齐', status: 'failed', received: 12, total: 100, speed: 0, source: 'ModelScope', error: 'HTTP 503: https://modelscope.cn/model' }],
}

describe('setup diagnostic reports', () => {
  it('prefills general feedback with current app information and excludes private configuration and URL parameters', () => {
    const info = { version: '0.0.7', platform: 'darwin', arch: 'arm64', osVersion: '25.0.0', page: '/workflows/example?token=private-query#private-fragment', language: 'zh', theme: 'system', userAgent: 'YouDub Electron/44.7.0', token: 'private-token', apiKey: 'private-key', homeDir: '/Users/private-name' }
    const url = new URL(feedbackIssue(info).url), body = url.searchParams.get('body')!
    expect(url.pathname).toBe('/liuzhao1225/YouDub-webui/issues/new')
    expect(url.searchParams.get('template')).toBe('bug-report.md')
    expect(url.searchParams.get('title')).toBe('[问题反馈] ')
    for (const value of ['YouDub: 0.0.7', 'macOS / 25.0.0', '架构: arm64', '页面: /workflows/example', '语言: zh', '主题: 自动（跟随系统）', 'Electron/44.7.0', '### 复现步骤', '### 预期结果', '### 实际结果']) expect(body).toContain(value)
    for (const value of ['private-query', 'private-fragment', 'private-token', 'private-key', 'private-name']) expect(body).not.toContain(value)
    expect(body).not.toContain('诊断日志')
  })
  it('includes selected resource failures in the same complete report and keeps errors last', () => {
    const resources = { status: 'failed' as const, selections: [{ providerId: 'whisper', model: 'tiny' }], requirements: [],
      environment: state.environment, models: state.models, error: 'resource preparation failed\nlast cause' }
    const report = setupReport({ ...state, phase: 'ready', error: undefined, environment: [], models: [], resources })
    expect(report).toContain('阶段: 准备失败')
    expect(report).toContain('Qwen3 Aligner')
    expect(report).toContain('last cause')
    expect(report.indexOf(resources.error)).toBeGreaterThan(report.indexOf('错误日志:'))
    const projected = resourceSetupState({ ...state, version: '0.0.7', osVersion: '25', homeDir: '/home/example', items: [], resources })
    expect(setupReport(projected)).toContain('last cause')
    expect(projected.environment).toEqual(resources.environment)
  })
  it('includes version, platform, environment and model failures', () => {
    const report = setupReport(state)
    for (const text of ['0.0.6', 'win32 x64 / 10.0.26100', '运行依赖', '阿里 PyPI', state.error!, 'No matching distribution', 'Qwen3 Aligner', '12/100 bytes', 'HTTP 503']) expect(report).toContain(text)
    const issue = setupIssue(report, state)
    const url = new URL(issue.url)
    expect(url.origin + url.pathname).toBe('https://github.com/liuzhao1225/YouDub-webui/issues/new')
    expect(url.searchParams.get('template')).toBe('setup-problem.md')
    expect(url.searchParams.get('title')).toBe('[环境配置] 准备失败')
    expect(url.searchParams.get('body')).toContain('YouDub: 0.0.6')
    expect(url.searchParams.get('body')).toContain('### 环境信息')
    expect(url.searchParams.get('body')).toContain('### 诊断日志')
    expect(url.searchParams.get('body')).toContain('环境配置页「复制日志」得到的完整诊断日志')
    expect(url.searchParams.get('body')).not.toContain('### 复现步骤')
    expect(report.indexOf('模型准备:')).toBeLessThan(report.indexOf('错误日志:'))
    for (const error of [state.error!, state.environment[0].detail!, state.models[0].error!]) expect(report.indexOf(error)).toBeGreaterThan(report.indexOf('错误日志:'))
  })
  it('preserves current installation activity when the log has no matching line and redacts it', () => {
    const report = setupReport({ ...state, environment: [{ id: 'python', name: 'Python', status: 'running', activity: 'Downloading https://example.com/python.tar.gz?token=private-value', log: 'Connecting' }] })
    expect(report).toContain('Downloading https://example.com/python.tar.gz?[REDACTED]')
    expect(report).toContain('Connecting')
    expect(report).not.toContain('private-value')
  })
  it('selects the environment template before the setup service connects', () => {
    const url = new URL(setupIssue(setupReport(null, 'Failed to fetch')).url)
    expect(url.searchParams.get('template')).toBe('setup-problem.md')
    expect(url.searchParams.get('title')).toBe('[环境配置] 连接准备服务')
    expect(url.searchParams.get('body')).toContain('阶段: 连接准备服务')
  })
  it('redacts credentials, signed URL values and home directories while keeping useful errors', () => {
    const report = setupReport({ ...state, error: [
      'https://alice:pass@example.com/python.tar.gz?X-Amz-Signature=signed-value#private-fragment',
      'Authorization: Bearer access-value', 'API_KEY="key value"', '{"token":"json-value"}',
      'C:\\Users\\Alice\\YouDub\\python.exe exited (9009)', '/Users/bob/Library/log', '/home/carol/log',
      'SETUP_TOKEN: private-setup-token',
    ].join('\n') })
    for (const secret of ['alice', 'pass@', 'signed-value', 'private-fragment', 'access-value', 'key value', 'json-value', 'Alice', 'bob', 'carol', 'private-setup-token']) expect(report).not.toContain(secret)
    expect(report).toContain('exited (9009)')
    expect(report).toContain('example.com/python.tar.gz')
    expect(redactDiagnostics('bad URL: https://[invalid?token=hidden')).not.toContain('hidden')
  })
  it('keeps long Unicode reports complete for copying and uses the same bounded feedback URL', () => {
    const report = setupReport({ ...state, error: '失败 🐍\n'.repeat(8000) + '最后的根因' })
    const issue = setupIssue(report, state)
    expect(report).toContain('最后的根因')
    expect(issue.url).toBe(setupIssue(setupReport(state), state).url)
    expect(issue.url.length).toBeLessThan(6000)
  })
  it('redacts the actual home directory for root and custom system layouts', () => {
    for (const homeDir of ['/root', '/var/root', '/srv/users/custom', 'D:\\Profiles\\custom']) {
      const report = setupReport({ ...state, homeDir, error: `stat '${homeDir}/private/python'\n${homeDir.replaceAll('\\', '/')}/download` })
      expect(report).not.toContain(homeDir)
      expect(report).not.toContain(homeDir.replaceAll('\\', '/'))
      expect(report).toContain('[HOME]/private/python')
    }
  })
})
