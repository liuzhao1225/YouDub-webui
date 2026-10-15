/** Accept one public video, preserving only its identity and Bilibili part. */
export function videoSource(value: string): { url: string; platform: 'YouTube' | 'Bilibili' } {
  const match = value.match(/https?:\/\/[^\s<>]+/)
  if (!match || match[0].length > 2048) throw new Error('请输入有效的视频链接。')
  const url = new URL(match[0].replace(/[，。；！、）)]+$/, ''))
  if (url.username || url.password || url.port) throw new Error('视频链接不能包含账号或端口。')
  const host = url.hostname.toLowerCase(), path = url.pathname
  let id: string | null = null
  if (host === 'youtu.be') id = path.slice(1)
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    id = path === '/watch' ? url.searchParams.get('v') : /^\/shorts\/([^/]+)\/?$/.exec(path)?.[1] ?? null
  }
  if (id && /^[\w-]{11}$/.test(id)) return { url: `https://www.youtube.com/watch?v=${id}`, platform: 'YouTube' }
  if (['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(host)) {
    const video = /^\/video\/(BV[\da-zA-Z]{10}|av\d+)\/?$/.exec(path)?.[1]
    const part = url.searchParams.get('p')
    if (video && (!part || /^[1-9]\d*$/.test(part))) return { url: `https://www.bilibili.com/video/${video}/${part ? `?p=${part}` : ''}`, platform: 'Bilibili' }
  }
  if (host === 'b23.tv' && /^\/[\da-zA-Z]+\/?$/.test(path)) return { url: `https://b23.tv${path}`, platform: 'Bilibili' }
  throw new Error('请输入 YouTube 或 B 站的单个视频链接。')
}
