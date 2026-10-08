import { Film } from "lucide-react"

import { cn } from "@/lib/utils"

// 生成封面：同一任务始终得到同一张，配色取自 logo 三色，叠加随机声波。
// v1 没有封面接口；列表里也不读取成品视频，避免占用产物导致删除被拒。
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
  size = "md",
  bars: showBars = true,
  className,
}: {
  id: string
  size?: "sm" | "md" | "lg"
  // 用作背景时关掉声波条，只保留配色光斑。
  bars?: boolean
  className?: string
}) {
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
      aria-hidden="true"
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
      {showBars ? (
        <div
          className={cn(
            "absolute inset-x-[16%] inset-y-[24%] flex items-center justify-center",
            size === "sm" ? "gap-[2px]" : "gap-[5%]",
          )}
        >
          {bars.map((height, index) => (
            <span
              key={index}
              className="w-full max-w-1.5 rounded-full bg-white/45 mix-blend-overlay"
              style={{ height: `${Math.round(height * 100)}%` }}
            />
          ))}
        </div>
      ) : null}
      {size !== "sm" ? (
        <span className="absolute top-2 left-2 flex items-center justify-center rounded-md bg-black/35 p-1 text-white backdrop-blur-sm">
          <Film className={glyphClass} />
        </span>
      ) : null}
    </div>
  )
}
