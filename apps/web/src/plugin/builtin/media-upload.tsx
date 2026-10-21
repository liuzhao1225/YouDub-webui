import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { FileText, Film, Upload, X } from 'lucide-react'
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
  useEffect(() => { if (!file && input.current) input.current.value = '' }, [file])
  const video = slot.acceptedMimeTypes.some((mime) => mime.startsWith('video/'))
  const Icon = video ? Film : FileText
  return <div>
    <label htmlFor={inputId} className="sr-only">{text(slot.label, language)}{slot.required ? ' *' : ''}</label>
    <div onDragEnter={() => { if (!disabled) setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!disabled && event.dataTransfer.files[0]) onChange(event.dataTransfer.files[0]) }} className={cn(
      'relative flex min-h-[132px] items-center justify-center rounded-[20px] border border-dashed px-5 py-6 transition-colors',
      'has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/25',
      dragActive ? 'border-brand-blue bg-secondary' : file ? 'border-border bg-muted' : 'border-input bg-muted hover:border-subtle-foreground/60 hover:bg-accent',
      disabled && 'opacity-60',
    )}>
      <input ref={input} id={inputId} type="file" disabled={disabled} required={slot.required && !file} accept={slot.acceptedMimeTypes.join(',')} className="absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" onChange={(event) => { setDragActive(false); const file = event.target.files?.[0]; if (file && slot.maxBytes && file.size > slot.maxBytes) event.target.value = ''; onChange(file) }} />
      {file ? <div className="flex w-full items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgb(251_114_153/0.25),rgb(0_174_236/0.25))] text-foreground ring-1 ring-border ring-inset"><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-medium">{file.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.size)} · {tx('Click or drop to replace', '点击或拖入以替换', 'クリックまたはドロップで差し替え')}</p></div>
        <Button type="button" variant="ghost" size="icon-sm" className="relative z-20" disabled={disabled} aria-label={`${tx('Remove', '移除', '削除')} ${file.name}`} onClick={() => { if (input.current) input.current.value = ''; onChange(undefined) }}><X /></Button>
      </div> : <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-card shadow-card ring-1 ring-border"><Upload className="size-5 text-brand-blue" /></span>
        <p className="text-[15px] font-medium">{video ? tx('Drop a video here, or click to choose', '拖入视频，或点击选择文件', '動画をドロップ、またはクリックして選択') : tx('Drop a file here, or click to choose', '拖入文件，或点击选择', 'ファイルをドロップ、またはクリックして選択')}</p>
        <p className="text-xs text-subtle-foreground">{text(slot.label, language)}{slot.required || alternative ? '' : ` · ${tx('Optional', '可选', '任意')}`}{slot.maxBytes ? ` · ${tx('Up to', '最大', '上限')} ${formatBytes(slot.maxBytes)}` : ''}</p>
      </div>}
    </div>
  </div>
}

export function LaunchCard({ children }: { children: ReactNode }) {
  return <div className="relative">
    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 bg-[radial-gradient(55%_60%_at_30%_45%,rgb(251_114_153/0.16),transparent_70%),radial-gradient(50%_60%_at_75%_55%,rgb(0_174_236/0.16),transparent_70%)] opacity-70 blur-2xl dark:opacity-100" />
    <div className="relative rounded-[28px] p-px before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgb(255_0_51/0.6),rgb(251_114_153/0.35)_42%,rgb(0_174_236/0.6))] before:opacity-45 before:transition-opacity before:duration-300 focus-within:before:opacity-100">
      <div className="relative rounded-[27px] bg-card p-2 shadow-float">{children}</div>
    </div>
  </div>
}
