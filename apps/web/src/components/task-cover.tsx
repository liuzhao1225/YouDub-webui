import { useState } from "react"
import { Film, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { useText } from "@/lib/i18n"

// 无可预览媒体时使用稳定的品牌背景；视频首帧由服务端生成缩略图。
const PALETTES: [string, string][] = [
  ["#fb7299", "#00aeec"],
  ["#ff0033", "#fb7299"],
  ["#00aeec", "#5b7cff"],
  ["#ff4d6d", "#00aeec"],
  ["#fb7299", "#9b7bff"],
  ["#00aeec", "#2dd4bf"],
]

function hashString(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function TaskCover({
  id,
  src,
  processing = false,
  size = "md",
  bars: showBars = true,
  className,
}: {
  id: string
  src?: string
  processing?: boolean
  size?: "sm" | "md" | "lg"
  // 用作背景时关掉声波条，只保留配色光斑。
  bars?: boolean
  className?: string
}) {
  const tx = useText()
  const [loadedSrc, setLoadedSrc] = useState<string>()
  const [failedSrc, setFailedSrc] = useState<string>()
  const failed = Boolean(src && failedSrc === src)
  const loading = Boolean(src && loadedSrc !== src && !failed)
  const seed = hashString(id)
  const [first, second] = PALETTES[seed % PALETTES.length]
  const firstX = 12 + (seed >>> 5) % 34
  const firstY = 18 + (seed >>> 9) % 44
  const secondX = 58 + (seed >>> 13) % 32
  const secondY = 40 + (seed >>> 17) % 48
  const bars = Array.from({ length: size === "sm" ? 7 : 13 }, (_, index) => (
    0.22 + ((hashString(`${id}:${index}`) % 78) / 100)
  ))
  const glyphClass = size === "lg" ? "size-5" : "size-4"

  return (
    <div
      data-testid="task-cover"
      className={cn(
        "relative isolate aspect-video shrink-0 overflow-hidden bg-[#0d0d12] ring-1 ring-white/10 ring-inset",
        size === "sm" ? "rounded-md" : size === "md" ? "rounded-xl" : "rounded-2xl",
        className,
      )}
      style={{
        backgroundImage: `radial-gradient(95% 125% at ${firstX}% ${firstY}%, ${first}e0 0%, transparent 58%), radial-gradient(85% 115% at ${secondX}% ${secondY}%, ${second}d0 0%, transparent 56%)`,
      }}
    >
      {src && !failed && (
        <div aria-hidden="true" className="absolute inset-0 scale-110 bg-cover bg-center opacity-70 blur-xl" style={{ backgroundImage: `url(${JSON.stringify(src)})` }} />
      )}
      {src && !failed && (
        // Authenticated local thumbnails already have a bounded size; load directly.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" onLoad={() => setLoadedSrc(src)} onError={() => setFailedSrc(src)}
          className="absolute inset-0 size-full object-contain" />
      )}
      {processing && <div aria-hidden="true" className="absolute inset-0 bg-black/35" />}
      {showBars && (processing || !src) ? (
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-x-[16%] inset-y-[24%] flex items-center justify-center",
            size === "sm" ? "gap-[2px]" : "gap-[5%]",
          )}
        >
          {bars.map((height, index) => (
            <span
              key={index}
              className={cn("w-full max-w-1.5 rounded-full", processing ? "animate-eq bg-white/85 shadow-sm" : "bg-white/45 mix-blend-overlay")}
              style={{ height: `${Math.round(height * 100)}%`, ...(processing && { animationDelay: `${-index * 0.17}s` }) }}
            />
          ))}
        </div>
      ) : null}
      {loading && <Loader2 aria-label={tx('Loading cover', '正在加载封面', 'カバーを読み込み中')} className="absolute top-2 right-2 size-4 animate-spin text-white" />}
      {failed && <p role="status" className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-center text-xs text-white">{tx('Cover failed to load', '封面加载失败', 'カバーを読み込めませんでした')}</p>}
      {size !== "sm" ? (
        <span aria-hidden="true" className="absolute top-2 left-2 flex items-center justify-center rounded-md bg-black/35 p-1 text-white backdrop-blur-sm">
          <Film className={glyphClass} />
        </span>
      ) : null}
    </div>
  )
}
