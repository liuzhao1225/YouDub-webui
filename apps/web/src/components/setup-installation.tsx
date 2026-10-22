import { useState } from 'react'
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
  const choose = async () => {
    setChoosing(true); setError('')
    try { const selected = await pickDirectory?.(); if (selected) setDirectory(selected) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setChoosing(false) }
  }
  return <form className="space-y-6" onSubmit={event => { event.preventDefault(); void configure(directory) }}>
    <h1 className="text-xl font-semibold">{text('setup.installation')}</h1>
    <div className="space-y-2">
      <label htmlFor="setup-language" className="text-sm font-medium">{text('nav.language')}</label>
      <NativeSelect id="setup-language" aria-label={text('nav.language')} value={language} disabled={busy || choosing} onChange={event => setLanguage(event.target.value)}>
        {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </div>
    <div className="space-y-2">
      <label htmlFor="setup-directory" className="text-sm font-medium">{text('setup.directory')}</label>
      <div className="flex gap-2">
        <Input id="setup-directory" aria-describedby="setup-directory-detail" className="min-w-0 flex-1" value={directory} disabled={busy || choosing} onChange={event => setDirectory(event.target.value)} />
        {pickDirectory && <Button type="button" variant="outline" disabled={busy || choosing} onClick={() => void choose()}>{text('setup.browse')}</Button>}
      </div>
      <p id="setup-directory-detail" className="text-xs text-muted-foreground">{text('setup.directoryDetail')}</p>
    </div>
    {error && <p role="alert" className="text-sm text-status-danger-fg">{error}</p>}
    <Button type="submit" disabled={busy || choosing || !directory.trim()}>{text('setup.install')}</Button>
  </form>
}
