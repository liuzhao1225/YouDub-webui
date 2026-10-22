import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LanguageProvider } from '@/lib/i18n'
import { SetupInstallation } from './setup-installation'

afterEach(cleanup)

it('changes language before installation and submits the native folder choice', async () => {
  const configure = vi.fn(async () => {}), pickDirectory = vi.fn(async () => '/Volumes/Media/YouDub')
  render(<LanguageProvider><SetupInstallation path="/default/YouDub" busy={false} configure={configure} pickDirectory={pickDirectory} /></LanguageProvider>)
  fireEvent.change(screen.getByLabelText('界面语言'), { target: { value: 'ja' } })
  await waitFor(() => expect(screen.getByText('インストール設定')).toBeTruthy())
  expect(configure).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('フォルダーを選択'))
  await waitFor(() => expect((screen.getByLabelText('インストール先') as HTMLInputElement).value).toBe('/Volumes/Media/YouDub'))
  fireEvent.click(screen.getByText('確認して環境を準備'))
  expect(configure).toHaveBeenCalledWith('/Volumes/Media/YouDub')
})
