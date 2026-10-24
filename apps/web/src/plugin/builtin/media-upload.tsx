import { Surface } from '@/components/ui/surface'
import { InlineAlert } from '@/components/inline-alert'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { FileText, Film, Upload, X } from '@/lib/icons'
import { text, type InputSlot } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function UploadSlot({ slot, file, disabled, alternative = false, onChange }: { slot: InputSlot; file?: File; disabled: boolean; alternative?: boolean; onChange(file?: File): void }) {
  const tx = useText()
  const { language } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [dragActive, setDragActive] = useState(false)
  const [loadingSample, setLoadingSample] = useState(false)
  const [sampleError, setSampleError] = useState('')
  disabled ||= loadingSample
  async function loadSample() {
    setLoadingSample(true); setSampleError('')
    try {
      const response = await fetch('/api/youdub/examples/assets/jensen-en.mp4')
      if (!response.ok) throw new Error(`jensen-en.mp4: HTTP ${response.status}`)
      onChange(new File([await response.blob()], 'jensen-en.mp4', { type: 'video/mp4' }))
    } catch (error) { setSampleError(error instanceof Error ? error.message : String(error)) }
    finally { setLoadingSample(false) }
  }
  useEffect(() => { if (!file && input.current) input.current.value = '' }, [file])
  const video = slot.acceptedMimeTypes.some((mime) => mime.startsWith('video/'))
  const Icon = video ? Film : FileText
  return <div>
    <label htmlFor={inputId} className="sr-only">{text(slot.label, language)}{slot.required ? ' *' : ''}</label>
    <div onDragEnter={() => { if (!disabled) setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!disabled && event.dataTransfer.files[0]) onChange(event.dataTransfer.files[0]) }} className={cn(
      'relative flex min-h-[132px] items-center justify-center rounded-xl border border-dashed px-4 py-6 transition-colors',
      'has-[input:focus-visible]:border-foreground/40',
      dragActive ? 'border-brand-blue bg-secondary' : file ? 'border-input bg-card' : 'border-input bg-card hover:border-subtle-foreground/40 hover:bg-surface',
      disabled && 'opacity-60',
    )}>
      <input ref={input} id={inputId} type="file" disabled={disabled} required={slot.required && !file} accept={slot.acceptedMimeTypes.join(',')} className="absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" onChange={(event) => { setDragActive(false); const file = event.target.files?.[0]; onChange(file) }} />
      {file ? <div className="flex w-full items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgb(251_114_153/0.25),rgb(0_174_236/0.25))] text-foreground ring-1 ring-border ring-inset"><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-medium">{file.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.size)} · {tx("media.upload.click.or.drop.to.replace")}</p></div>
        <Button type="button" variant="ghost" size="icon-sm" className="relative z-20" disabled={disabled} aria-label={`${tx("media.upload.remove")} ${file.name}`} onClick={() => { if (input.current) input.current.value = ''; onChange(undefined) }}><X /></Button>
      </div> : <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="flex size-11 items-center justify-center rounded-lg bg-card"><Upload className="size-5 text-link" /></span>
        <p className="text-[15px] font-medium">{video ? tx("media.upload.drop.a.video.here.or.click.to.choose") : tx("media.upload.drop.a.file.here.or.click.to.choose")}</p>
        <p className="text-xs text-muted-foreground">{[!alternative && text(slot.label, language), !slot.required && !alternative && tx("media.upload.optional")].filter(Boolean).join(' · ')}</p>
      </div>}
    </div>
    {video && !file && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => void loadSample()} className="mt-2">{tx('media.upload.use.sample')}</Button>}
    {sampleError && <InlineAlert className="mt-2">{sampleError}</InlineAlert>}
  </div>
}

export function LaunchCard({ children }: { children: ReactNode }) {
  return <div className="relative">
    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 bg-[radial-gradient(55%_60%_at_30%_45%,rgb(251_114_153/0.16),transparent_70%),radial-gradient(50%_60%_at_75%_55%,rgb(0_174_236/0.16),transparent_70%)] opacity-70 blur-2xl dark:opacity-100" />
    <Surface as="div" className="@container/launch relative">
      <div className="relative rounded-2xl p-4 sm:p-6">{children}</div>
    </Surface>
  </div>
}
