import { RefObject, useEffect } from "react"

// 卸载时主动断开音视频请求：v1 后端在产物仍被读取时会拒绝删除任务（TASK_BUSY）。
export function useReleaseMediaOnUnmount(ref: RefObject<HTMLMediaElement | null>, src: string) {
  useEffect(() => {
    const media = ref.current
    if (!media) return
    // 开发环境的 StrictMode 会先模拟一次卸载，这里把地址补回去。
    if (!media.getAttribute("src")) media.setAttribute("src", src)
    return () => {
      if (!media.paused) media.pause()
      media.removeAttribute("src")
      if (media.networkState !== HTMLMediaElement.NETWORK_EMPTY) media.load()
    }
  }, [ref, src])
}
