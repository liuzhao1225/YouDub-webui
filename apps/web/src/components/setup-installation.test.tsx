import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LanguageProvider } from '@/lib/i18n'
import { SetupInstallation } from './setup-installation'

afterEach(() => { cleanup(); window.localStorage.clear() })

it('changes language before installation and submits the native folder choice', async () => {
  const configure = vi.fn(async () => {}), pickDirectory = vi.fn(async () => '/Volumes/Media/YouDub')
  render(<LanguageProvider><SetupInstallation path="/default/YouDub" busy={false} configure={configure} pickDirectory={pickDirectory} /></LanguageProvider>)
  fireEvent.click(screen.getByLabelText('界面语言'))
  fireEvent.click(screen.getByRole('menuitem', { name: '日本語' }))
  await waitFor(() => expect(screen.getByText('インストール設定')).toBeTruthy())
  expect(configure).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('フォルダーを選択'))
  await waitFor(() => expect((screen.getByLabelText('インストール先') as HTMLInputElement).value).toBe('/Volumes/Media/YouDub'))
  expect(screen.getByText('フォルダーを選択')).toHaveFocus()
  fireEvent.click(screen.getByText('確認して環境を準備'))
  expect(configure).toHaveBeenCalledWith('/Volumes/Media/YouDub')
})

it('retains the directory and restores focus when the native picker is cancelled', async () => {
  render(<LanguageProvider><SetupInstallation path="/default/YouDub" busy={false} configure={vi.fn()} pickDirectory={async () => null} /></LanguageProvider>)
  const choose = screen.getByRole('button', { name: '选择文件夹' })
  fireEvent.click(choose)
  await waitFor(() => expect(choose).toHaveFocus())
  expect(screen.getByLabelText('安装目录')).toHaveValue('/default/YouDub')
})
