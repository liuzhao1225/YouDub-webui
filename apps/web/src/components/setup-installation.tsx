import { useEffect, useRef, useState } from 'react'
import { PageTitle } from './page-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { LANGUAGE_OPTIONS, useI18n, useText } from '@/lib/i18n'

export function SetupInstallation({ path, busy, configure, pickDirectory }: {
  path: string; busy: boolean; configure: (path: string) => Promise<void>; pickDirectory?: () => Promise<string | null>
}) {
  const text = useText(), { language, setLanguage } = useI18n()
  const [directory, setDirectory] = useState(path)
  const [choosing, setChoosing] = useState(false), [error, setError] = useState('')
  const directoryRef = useRef<HTMLInputElement>(null), pickerRef = useRef<HTMLButtonElement>(null)
  const restorePickerFocus = useRef(false)
  useEffect(() => {
    if (busy || choosing) return
    if (error) directoryRef.current?.focus()
    else if (restorePickerFocus.current) pickerRef.current?.focus()
    restorePickerFocus.current = false
  }, [busy, choosing, error])
  const choose = async () => {
    restorePickerFocus.current = true
    setChoosing(true); setError('')
    try { const selected = await pickDirectory?.(); if (selected) setDirectory(selected) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setChoosing(false) }
  }
  const submit = async () => {
    setError('')
    try { await configure(directory) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <form className="space-y-6" onSubmit={event => { event.preventDefault(); void submit() }}>
    <PageTitle>{text('setup.installation')}</PageTitle>
    <div className="space-y-2">
      <label htmlFor="setup-language" className="block text-sm font-medium">{text('nav.language')}</label>
      <NativeSelect id="setup-language" aria-label={text('nav.language')} value={language} disabled={busy || choosing} onChange={event => setLanguage(event.target.value)}>
        {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </div>
    <div className="space-y-2">
      <label htmlFor="setup-directory" className="block text-sm font-medium">{text('setup.directory')}</label>
      <div className="flex gap-2">
        <Input ref={directoryRef} id="setup-directory" aria-describedby={`setup-directory-detail${error ? ' setup-directory-error' : ''}`} className="min-w-0 flex-1" value={directory} disabled={busy || choosing} onChange={event => setDirectory(event.target.value)} />
        {pickDirectory && <Button ref={pickerRef} type="button" variant="outline" disabled={busy || choosing} onClick={() => void choose()}>{text('setup.browse')}</Button>}
      </div>
      <p id="setup-directory-detail" className="text-xs text-muted-foreground">{text('setup.directoryDetail')}</p>
    </div>
    {error && <p id="setup-directory-error" role="alert" className="break-words text-sm text-status-danger-fg">{error}</p>}
    <Button type="submit" disabled={busy || choosing || !directory.trim()}>{text('setup.install')}</Button>
  </form>
}
