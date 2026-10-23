import { Disclosure } from '@/components/ui/disclosure'
import { Check, CircleAlert, Download, Loader2, Pause, Play, RotateCcw } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { MessageKey } from '@/locales'
import type { ResourceAction, ResourceEntry } from '@/runtime/setup-contracts'
import { ResourceProgress, sizeLabel } from './setup-resources'

const names: Record<string, MessageKey> = { acceleration: 'resource.inference', resources: 'setup.resources', 'youdub.download': 'resource.videoDownload' }
const purposes: Record<string, MessageKey> = { whisper: 'setup.whisper', voxcpm: 'setup.voxcpm', demucs: 'setup.demucs', qwen: 'setup.qwen' }
const icons = { prepare: Download, retry: RotateCcw, pause: Pause, resume: Play }
export function ResourceRow({ entry, busy = false, onAction }: { entry: ResourceEntry; busy?: boolean; onAction?: (action: ResourceAction, entry: ResourceEntry) => void }) {
  const tx = useText()
  const name = names[entry.id] ? tx(names[entry.id]) : entry.name
  const inProgress = entry.status === 'preparing' || entry.status === 'checking'
  const failed = entry.status === 'failed' || entry.status === 'blocked'
  const progress = entry.progress
  const showProgress = progress && (entry.phase === 'downloading' || entry.status === 'paused' || entry.status === 'failed')
  const action = entry.actions[0]
  const Icon = action && icons[action]
  // Subprocess errors prefix stderr with the executable path; keep the cause in
  // the row and retain the complete, unchanged output in the disclosure.
  const errorSummary = entry.error?.replace(/^[^\n]+ exited \([^\n]+\)\.\r?\n/, '').trim().split(/\r?\n/, 1)[0] || entry.error
  return <div id={`resource-${entry.id}`} className="min-w-0 space-y-2 py-4" role="group" aria-label={name}>
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1"><p title={[name, entry.variant].filter(Boolean).join(" ")} className="break-words text-sm font-medium">{name}{entry.variant && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{entry.variant}</span>}</p>{purposes[entry.id] && <p className="text-xs text-muted-foreground">{tx(purposes[entry.id])}</p>}</div>
      <span role="status" className={cn('inline-flex items-center gap-1.5 text-xs', failed ? 'text-status-danger-fg' : entry.status === 'ready' ? 'text-status-success-fg' : 'text-muted-foreground')}>
        {inProgress ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : entry.status === 'ready' ? <Check aria-hidden="true" className="size-4" /> : failed ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
        {tx(`resource.status.${entry.status}`)}{entry.phase && inProgress && <> · {tx(`resource.phase.${entry.phase}`)}</>}
      </span>
      {action && Icon && onAction && <Button variant="outline" size="sm" disabled={busy} aria-label={`${tx(`resource.action.${action}`)} ${name}`} onClick={() => onAction(action, entry)}><Icon />{tx(`resource.action.${action}`)}</Button>}
    </div>
    {entry.error && <p className="line-clamp-3 break-words text-xs text-status-danger-fg">{errorSummary}</p>}
    {entry.status === 'blocked' && entry.dependencies.length > 0 && <div className="flex flex-wrap gap-2 text-xs">{entry.dependencies.map(id => <a key={id} className="text-link hover:underline" href={`#resource-${id}`}>{tx('resource.dependency', { name: names[id] ? tx(names[id]) : id === 'python' ? 'Python' : id === 'ffmpeg' ? 'FFmpeg' : id })}</a>)}</div>}
    {showProgress && <div className="space-y-1"><ResourceProgress value={progress.total > 0 ? progress.received / progress.total : undefined} label={tx('setup.modelProgress', { model: name })} paused={entry.status === 'paused'} /><p className="text-xs tabular-nums text-muted-foreground">{sizeLabel(progress.received)}{progress.total > 0 && <> / {sizeLabel(progress.total)}</>}{entry.phase === 'downloading' && progress.speed ? ` · ${sizeLabel(progress.speed)}/s` : ''}</p></div>}
    {(entry.error || entry.detail || entry.source || progress && !showProgress) && <Disclosure contained={false} title={tx('settings.resources.diagnostics')}><div className="mt-2 space-y-1 break-words">{entry.error && <pre tabIndex={0} aria-label={`${tx('settings.resources.diagnostics')} ${name}`} className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans">{entry.error}</pre>}{entry.detail && entry.detail !== entry.error && <p className="whitespace-pre-wrap">{entry.detail}</p>}{entry.source && <p>{entry.source}</p>}{progress && !showProgress && <p>{sizeLabel(progress.received)}{progress.total > 0 && <> / {sizeLabel(progress.total)}</>}</p>}</div></Disclosure>}
  </div>
}
