import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import type { TaskView } from './sdk'
import { TaskProgress, TaskState } from './builtin/task-status'

const task: TaskView = {
  id: 'task', attempt: 1, status: 'running', sourceName: 'video.mp4', createdAt: '2026-10-09T00:00:00Z',
  workflowId: 'test', workflowVersion: '1', config: {}, outputs: [], allowedActions: [],
  steps: [{ id: 'first', label: '前一步', status: 'completed', progress: 1 }, { id: 'current', label: '生成配音', status: 'running', progress: 0.25 }],
}
afterEach(() => { cleanup(); window.localStorage.clear() })

it('labels numerical progress as the current step, while retaining completed step counts', () => {
  render(<LanguageProvider><TaskProgress task={task} /></LanguageProvider>)
  expect(screen.getByText('生成配音 · 25%')).toBeInTheDocument()
  expect(screen.getByText('已完成 1/2 步')).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: '生成配音 进度' })).toHaveAttribute('value', '0.25')
})

it.each([
  ['queued', '排队中'], ['waiting', '等待中'], ['cancelling', '正在取消'],
  ['succeeded', '已完成'], ['failed', '失败'], ['cancelled', '已取消'],
] as const)('keeps %s distinct and never presents an old running step as live progress', (status, label) => {
  render(<LanguageProvider><TaskState status={status} /><TaskProgress task={{ ...task, status }} /></LanguageProvider>)
  expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.queryByText(/25%/)).not.toBeInTheDocument()
  if (['succeeded', 'failed', 'cancelled'].includes(status)) expect(screen.queryByText('生成配音')).not.toBeInTheDocument()
})
