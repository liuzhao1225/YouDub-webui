import { describe, expect, it } from 'vitest'
import type { SetupState } from '@/components/setup-screen'
import { redactDiagnostics, setupIssue, setupReport } from './setup-diagnostics'

const state: SetupState = {
  version: '0.0.6', platform: 'win32', arch: 'x64', osVersion: '10.0.26100', phase: 'failed', token: 'private-setup-token', canRetry: true,
  error: 'Python exited (1).\nTraceback:\nModuleNotFoundError: torch',
  environment: [{ id: 'dependencies', name: '运行依赖', status: 'failed', source: '阿里 PyPI', detail: 'No matching distribution found' }],
  models: [{ id: 'qwen', name: 'Qwen3 Aligner', variant: '0.6B', purpose: '字幕对齐', status: 'failed', received: 12, total: 100, speed: 0, source: 'ModelScope', error: 'HTTP 503: https://modelscope.cn/model' }],
}

describe('setup diagnostic reports', () => {
  it('includes version, platform, environment and model failures without copying the setup token', () => {
    const report = setupReport(state)
    for (const text of ['0.0.6', 'win32 x64 / 10.0.26100', '运行依赖', '阿里 PyPI', state.error!, 'No matching distribution', 'Qwen3 Aligner', '12/100 bytes', 'HTTP 503']) expect(report).toContain(text)
    expect(report).not.toContain(state.token)
    const issue = setupIssue(report, state)
    const url = new URL(issue.url)
    expect(url.origin + url.pathname).toBe('https://github.com/liuzhao1225/YouDub-webui/issues/new')
    expect(url.searchParams.get('template')).toBe('setup-problem.md')
    expect(url.searchParams.get('body')).toContain('YouDub: 0.0.6')
    expect(url.searchParams.get('body')).toContain('请在这里粘贴从准备页复制的完整诊断日志')
    expect(report.indexOf('模型准备:')).toBeLessThan(report.indexOf('错误日志:'))
    for (const error of [state.error!, state.environment[0].detail!, state.models[0].error!]) expect(report.indexOf(error)).toBeGreaterThan(report.indexOf('错误日志:'))
  })
  it('redacts credentials, signed URL values and home directories while keeping useful errors', () => {
    const report = setupReport({ ...state, error: [
      'https://alice:pass@example.com/python.tar.gz?X-Amz-Signature=signed-value#private-fragment',
      'Authorization: Bearer access-value', 'API_KEY="key value"', '{"token":"json-value"}',
      'C:\\Users\\Alice\\YouDub\\python.exe exited (9009)', '/Users/bob/Library/log', '/home/carol/log',
      'setup: private-setup-token',
    ].join('\n') })
    for (const secret of ['alice', 'pass@', 'signed-value', 'private-fragment', 'access-value', 'key value', 'json-value', 'Alice', 'bob', 'carol', state.token]) expect(report).not.toContain(secret)
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
})
