"use client"

import { CSSProperties, KeyboardEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react"
import {
  Check,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react"

import { useI18n } from "@/lib/i18n"
import { useReleaseMediaOnUnmount } from "@/lib/media"
import { cn } from "@/lib/utils"

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SEEK_STEP_SECONDS = 5
const CONTROLS_HIDE_DELAY_MS = 2500

type VideoElement = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

function formatClock(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00"
  const total = Math.floor(value)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, "0")
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`
}

// 提示用原生 title：自定义浮层挂在 body 上，全屏时不可见。
function ControlButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors outline-none hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 [&_svg]:size-[18px]"
    >
      {children}
    </button>
  )
}

export function VideoPlayer({ src, className, onError }: { src: string; className?: string; onError?: () => void }) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<VideoElement>(null)
  const speedMenuRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | null>(null)
  const touchRevealRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [rate, setRate] = useState(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [pipSupported, setPipSupported] = useState(false)
  useReleaseMediaOnUnmount(videoRef, src)

  useEffect(() => {
    const handleFullscreenChange = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    window.setTimeout(() => setPipSupported(Boolean(document.pictureInPictureEnabled)), 0)
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!speedOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!speedMenuRef.current?.contains(event.target as Node)) setSpeedOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [speedOpen])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false)
        setSpeedOpen(false)
      }
    }, CONTROLS_HIDE_DELAY_MS)
  }, [])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused || video.ended) void video.play().catch(() => {})
    else video.pause()
  }

  function seekTo(time: number) {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return
    video.currentTime = Math.min(Math.max(time, 0), video.duration)
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    if (!video.muted && video.volume === 0) video.volume = 0.6
  }

  function changeVolume(value: number) {
    const video = videoRef.current
    if (!video) return
    video.volume = value
    video.muted = value === 0
  }

  function changeRate(value: number) {
    const video = videoRef.current
    if (video) video.playbackRate = value
    setSpeedOpen(false)
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    const container = containerRef.current
    if (container?.requestFullscreen) {
      void container.requestFullscreen().catch(() => {})
      return
    }
    // iPhone 上的 Safari 只允许视频元素自身进入全屏。
    videoRef.current?.webkitEnterFullscreen?.()
  }

  function togglePictureInPicture() {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {})
    else void video.requestPictureInPicture().catch(() => {})
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const video = videoRef.current
    if (!video || event.metaKey || event.ctrlKey || event.altKey) return
    // 焦点在进度条/音量滑块上时，方向键交给滑块本身。
    const onSlider = event.target instanceof HTMLInputElement
    switch (event.key) {
      case " ":
      case "k":
      case "K":
        if (event.target instanceof HTMLButtonElement && event.key === " ") return
        event.preventDefault()
        togglePlay()
        break
      case "ArrowLeft":
        if (onSlider) return
        event.preventDefault()
        seekTo(video.currentTime - SEEK_STEP_SECONDS)
        break
      case "ArrowRight":
        if (onSlider) return
        event.preventDefault()
        seekTo(video.currentTime + SEEK_STEP_SECONDS)
        break
      case "m":
      case "M":
        event.preventDefault()
        toggleMute()
        break
      case "f":
      case "F":
        event.preventDefault()
        toggleFullscreen()
        break
      case "Escape":
        if (!speedOpen) return
        setSpeedOpen(false)
        break
      default:
        return
    }
    revealControls()
  }

  const progress = duration ? (currentTime / duration) * 100 : 0
  const bufferedPercent = duration ? (buffered / duration) * 100 : 0
  const effectiveVolume = muted ? 0 : volume
  const VolumeIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2
  const showControls = controlsVisible || !playing

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={t.player.label}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (playing) setControlsVisible(false)
      }}
      className={cn(
        "group/player relative overflow-hidden bg-black outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
        fullscreen ? "flex size-full items-center justify-center" : "aspect-video",
        !showControls && "cursor-none",
        className,
        fullscreen && "rounded-none border-0",
      )}
    >
      <video
        ref={videoRef}
        src={src}
        crossOrigin="use-credentials"
        preload="metadata"
        playsInline
        className="size-full bg-black object-contain"
        onPointerDown={(event) => {
          // 触屏上控件已隐藏时，第一次轻点只唤出控件，不暂停播放。
          touchRevealRef.current = event.pointerType === "touch" && playing && !controlsVisible
        }}
        onClick={() => {
          setSpeedOpen(false)
          if (touchRevealRef.current) {
            touchRevealRef.current = false
            revealControls()
            return
          }
          togglePlay()
        }}
        onDoubleClick={toggleFullscreen}
        onPlay={() => {
          setPlaying(true)
          setStarted(true)
          revealControls()
        }}
        onPause={() => {
          setPlaying(false)
          setControlsVisible(true)
        }}
        onError={onError}
        onEnded={() => {
          setPlaying(false)
          setControlsVisible(true)
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onProgress={(event) => {
          const ranges = event.currentTarget.buffered
          if (ranges.length) setBuffered(ranges.end(ranges.length - 1))
        }}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted)
          setVolume(event.currentTarget.volume)
        }}
        onRateChange={(event) => setRate(event.currentTarget.playbackRate)}
      />

      {!started ? (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={t.player.play}
          className="absolute inset-0 z-10 m-auto flex size-16 items-center justify-center rounded-full bg-white/15 text-white shadow-[0_8px_32px_rgb(0_0_0/0.35)] ring-1 ring-white/25 backdrop-blur-md transition-[background-color,transform] outline-none hover:scale-105 hover:bg-white/25 focus-visible:ring-3 focus-visible:ring-white/60"
        >
          <Play className="ml-1 size-7 fill-current" />
        </button>
      ) : null}

      {/* 渐变遮罩本身不拦截点击，轻点遮罩区域仍然作用于视频；只有控件可交互。 */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-14 pb-2.5 text-white transition-opacity duration-200 sm:px-4",
          showControls ? "opacity-100" : "opacity-0",
        )}
      >
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => seekTo(Number(event.target.value))}
          aria-label={t.player.seek}
          aria-valuetext={`${formatClock(currentTime)} / ${formatClock(duration)}`}
          className={cn("player-range block w-full", showControls && "pointer-events-auto")}
          style={{ "--progress": `${progress}%`, "--buffered": `${bufferedPercent}%` } as CSSProperties}
        />
        <div className={cn("mt-0.5 flex items-center gap-0.5", showControls && "pointer-events-auto")}>
          <ControlButton label={playing ? t.player.pause : t.player.play} shortcut="Space" onClick={togglePlay}>
            {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </ControlButton>
          <div className="group/volume flex items-center">
            <ControlButton label={effectiveVolume === 0 ? t.player.unmute : t.player.mute} shortcut="M" onClick={toggleMute}>
              <VolumeIcon />
            </ControlButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={effectiveVolume}
              onChange={(event) => changeVolume(Number(event.target.value))}
              aria-label={t.player.volume}
              className="player-range hidden w-0 opacity-0 transition-[width,opacity,margin] duration-200 group-hover/volume:mx-1.5 group-hover/volume:w-20 group-hover/volume:opacity-100 focus-visible:mx-1.5 focus-visible:w-20 focus-visible:opacity-100 sm:block"
              style={{ "--progress": `${effectiveVolume * 100}%` } as CSSProperties}
            />
          </div>
          <span className="ml-1.5 font-mono text-xs tabular-nums text-white/85">
            {formatClock(currentTime)} / {formatClock(duration)}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <div ref={speedMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setSpeedOpen((open) => !open)}
                aria-label={t.player.speed}
                aria-haspopup="menu"
                aria-expanded={speedOpen}
                title={t.player.speed}
                className="flex h-8 min-w-11 items-center justify-center rounded-md px-2 font-mono text-xs font-semibold tabular-nums text-white/90 transition-colors outline-none hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 aria-expanded:bg-white/15"
              >
                {rate}x
              </button>
              {speedOpen ? (
                <div
                  role="menu"
                  aria-label={t.player.speed}
                  className="absolute right-0 bottom-10 min-w-28 rounded-xl border border-white/10 bg-black/85 p-1 shadow-[0_12px_32px_rgb(0_0_0/0.5)] backdrop-blur-md"
                >
                  {SPEEDS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={rate === value}
                      onClick={() => changeRate(value)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition-colors outline-none hover:bg-white/15 focus-visible:bg-white/15",
                        rate === value ? "text-[#5fd0f5]" : "text-white/90",
                      )}
                    >
                      {value}x
                      {rate === value ? <Check className="size-3.5" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {pipSupported ? (
              <ControlButton label={t.player.pip} onClick={togglePictureInPicture}>
                <PictureInPicture2 />
              </ControlButton>
            ) : null}
            <ControlButton
              label={fullscreen ? t.player.exitFullscreen : t.player.fullscreen}
              shortcut="F"
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize /> : <Maximize />}
            </ControlButton>
          </div>
        </div>
      </div>
    </div>
  )
}
