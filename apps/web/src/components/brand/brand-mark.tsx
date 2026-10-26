import { cn } from "@/lib/utils"
import type { CSSProperties } from "react"

// 形状取自 public/youdub-icon.svg：左侧粉色声波、中间红色播放气泡、右侧蓝色声波。
const PINK_BARS = [
  { x: 0, height: 64, delay: -0.62 },
  { x: 42, height: 130, delay: -0.21 },
  { x: 84, height: 223, delay: -0.84 },
  { x: 126, height: 109, delay: -0.43 },
]

const BLUE_BARS = [
  { x: 564, height: 109, delay: -0.33 },
  { x: 606, height: 223, delay: -0.74 },
  { x: 648, height: 130, delay: -0.12 },
  { x: 690, height: 64, delay: -0.53 },
]

export function BrandMark({
  animated = false,
  wordmark = false,
  wordmarkSrc,
  className,
}: {
  animated?: boolean
  wordmark?: boolean
  wordmarkSrc?: string
  className?: string
}) {
  // Keep the stagger in the utility layer: the desktop build makes animation utilities important.
  const barClass = animated ? "animate-eq origin-center [transform-box:fill-box] [animation-delay:var(--eq-delay)]" : undefined
  return (
    <svg viewBox={wordmark ? "0 -56 1660 412" : "0 -56 717 412"} aria-hidden="true" className={cn("h-10 w-auto", className)}>
      {PINK_BARS.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={150 - bar.height / 2}
          width="27"
          height={bar.height}
          rx="13.5"
          className={cn("fill-brand-pink", barClass)}
          style={animated ? { '--eq-delay': `${bar.delay}s` } as CSSProperties : undefined}
        />
      ))}
      <rect x="174" width="369" height="300" rx="70" className="fill-brand-red" />
      <path
        d="M424.082 136.962C434.193 142.714 434.193 157.286 424.082 163.038L315.667 224.715C305.668 230.404 293.25 223.182 293.25 211.678V88.3224C293.25 76.8178 305.668 69.5958 315.667 75.2846L424.082 136.962Z"
        fill="#fff"
      />
      <path
        d="M348.5 300C348.5 300 348.73 299.977 349.081 300H433C433 300 365.25 348.453 356 353C346.482 357.679 343.904 350.5 344.5 346C345.096 341.5 351.5 311.5 352.5 305.5C353.286 300.786 350.367 300.084 349.081 300H348.5Z"
        className="fill-brand-red"
      />
      {BLUE_BARS.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={150 - bar.height / 2}
          width="27"
          height={bar.height}
          rx="13.5"
          className={cn("fill-brand-blue", barClass)}
          style={animated ? { '--eq-delay': `${bar.delay}s` } as CSSProperties : undefined}
        />
      ))}
      {wordmark && (
        // Both assets center the body, waves and lettering at y=150; the tail has matching top clearance.
        <svg x="717" y="-56" width="943" height="412" viewBox="717 -56 943 412" overflow="hidden">
          <image href={wordmarkSrc} y="-56" width="1660" height="412" />
        </svg>
      )}
    </svg>
  )
}
