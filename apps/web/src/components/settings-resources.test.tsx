import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/test/language-provider'
import { resourceEntries } from '@/runtime/setup-contracts'
import type { ResourceInventory, ResourcePreparation } from '@/runtime/setup-contracts'
import { SettingsResources } from './settings-resources'

afterEach(cleanup)
const inventory: ResourceInventory = {
  version: '0.0.7', platform: 'darwin', arch: 'arm64', osVersion: '25', homeDir: '/Users/test',
  environment: [{ id: 'python', name: 'Python 3.12', status: 'ready' }],
  items: [{ providerId: 'youdub.media', label: 'FFmpeg', automatic: true }, { providerId: 'whisper', model: 'tiny', label: 'Whisper', automatic: true, downloadId: 'whisper' }],
  models: [{ id: 'whisper', name: 'Whisper', variant: 'tiny', purpose: '语音识别', received: 0, total: 100, speed: 0, status: 'pending' }],
}
const inspection: ResourcePreparation = { status: 'missing', selections: [],
  environment: [{ id: 'python', name: 'Python 3.12', status: 'ready' }, { id: 'ffmpeg', name: 'FFmpeg', status: 'pending' }],
  models: inventory.models, requirements: [{ providerId: 'youdub.media', automatic: true, ready: false, missingPackages: [] },
    { providerId: 'whisper', model: 'tiny', automatic: true, ready: false, missingPackages: [] }],
}

inspection.entries = resourceEntries({ ...inspection, requirements: inspection.requirements.map(item => ({ ...item, resourceId: item.providerId === 'youdub.media' ? 'ffmpeg' : 'whisper', name: item.providerId === 'youdub.media' ? 'FFmpeg' : 'Whisper', downloadId: item.model ? 'whisper' : undefined })) })

it('shows one FFmpeg row and prepares only the clicked model after explicit user action', async () => {
  const request = vi.fn(async (path: string) => path.endsWith('/resources') ? inventory : inspection)
  render(<LanguageProvider><SettingsResources request={request as never} /></LanguageProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: '准备 Whisper' })).toBeEnabled())
  expect(screen.getAllByText('FFmpeg')).toHaveLength(1)
  expect(request.mock.calls.some(([path]) => path.endsWith('/prepare'))).toBe(false)
  await userEvent.setup().click(screen.getByRole('button', { name: '准备 Whisper' }))
  const mutation = (request.mock.calls as unknown as [string, RequestInit][]).find(([path]) => path.endsWith('/prepare'))
  expect(JSON.parse(mutation![1].body as string)).toEqual({ resourceIds: ['whisper'] })
  expect(screen.getByRole('region', { name: '诊断日志' })).toBeInTheDocument()
})

it('keeps uninspected resource readiness explicit when the initial check fails', async () => {
  const request = vi.fn().mockResolvedValueOnce(inventory).mockRejectedValue(new Error('Python path unavailable'))
  render(<LanguageProvider><SettingsResources request={request} /></LanguageProvider>)
  await waitFor(() => expect(screen.getByText('环境尚未检测')).toBeInTheDocument())
  expect(screen.queryByText('已就绪')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^准备 / })).not.toBeInTheDocument()
  expect((screen.getByRole('textbox', { name: '诊断日志内容' }) as HTMLTextAreaElement).value).toContain('Python path unavailable')
})
