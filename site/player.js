import { demos } from './demos.js?v=0.0.2'
const icons = {
  play: '<path class="play-icon" d="m7 4 14 8-14 8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  volume: '<path d="m11 5-6 5H2v4h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 5-6 5H2v4h3l6 5zM16 9l5 6m0-6-5 6"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
}
const svg = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24">${icons[name]}</svg>`
const time = (value) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`

// Both complete media files are loaded before playback. Language changes only
// switch the visible picture and audible track; they never set src or seek.
class PairedPlayer {
  constructor(id, demo) {
    this.id = id
    this.language = 'zh'
    this.ready = false
    this.playing = false
    this.busy = false
    this.muted = false
    this.volume = 1
    this.root = document.createElement('section')
    this.root.className = 'player'
    this.root.setAttribute('aria-label', `${demo.title}中英文对照播放器`)
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="player-toolbar"><div class="language-tabs" role="tablist" aria-label="视频语言">
        <button type="button" role="tab" id="${id}-tab-en" aria-controls="${id}-panel" aria-selected="false" tabindex="-1" data-language="en" disabled>原始英文</button>
        <button type="button" role="tab" id="${id}-tab-zh" aria-controls="${id}-panel" aria-selected="true" tabindex="0" data-language="zh" disabled>中文配音</button>
      </div></div>
      <div class="video-stage" role="tabpanel" id="${id}-panel" aria-labelledby="${id}-tab-zh">
        <img class="video-poster" src="./assets/${id}-poster.jpg" alt="" />
        <video playsinline preload="auto" muted data-language="en" aria-hidden="true"></video>
        <video playsinline preload="auto" muted data-language="zh" aria-hidden="true"></video>
        <button class="start-overlay" type="button" aria-label="播放${demo.title}" disabled>${svg('play')}</button>
        <div class="loading" role="status">正在加载中英文视频…</div>
      </div>
      <div class="controls">
        <button class="icon-button play" type="button" aria-label="播放" disabled>${svg('play')}</button>
        <span class="time">0:00 / 0:00</span>
        <input class="seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="播放进度" disabled>
        <button class="icon-button mute" type="button" aria-label="静音">${svg('volume')}</button>
        <input class="volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="音量">
        <button class="icon-button fullscreen" type="button" aria-label="全屏">${svg('fullscreen')}</button>
      </div>
      <div class="player-error" role="alert" hidden><div></div><button type="button">重新加载页面</button></div>`
    this.videos = [...this.root.querySelectorAll('video')]
    this.tabs = [...this.root.querySelectorAll('[role=tab]')]
    this.playButton = this.root.querySelector('.play')
    this.overlay = this.root.querySelector('.start-overlay')
    this.seek = this.root.querySelector('.seek')
    this.clock = this.root.querySelector('.time')
    this.playButton.addEventListener('click', () => this.toggle())
    this.overlay.addEventListener('click', () => this.toggle())
    this.root.querySelector('.video-stage').addEventListener('click', (event) => {
      if (event.target.closest('button')) return
      this.toggle()
    })
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.selectLanguage(tab.dataset.language))
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'en' : event.key === 'End' ? 'zh' : tab.dataset.language === 'zh' ? 'en' : 'zh'
        this.selectLanguage(next)
        this.tabs.find((item) => item.dataset.language === next).focus()
      })
    }
    this.seek.addEventListener('input', () => {
      if (this.scrubbing === undefined) { this.scrubbing = this.playing; this.pause() }
      this.renderTime(Number(this.seek.value))
    })
    this.seek.addEventListener('change', () => this.run(async () => {
      const resume = this.scrubbing
      const target = Number(this.seek.value)
      await Promise.all(this.videos.map((video) => seekVideo(video, target)))
      this.scrubbing = undefined
      if (resume) await this.start()
    }))
    this.root.querySelector('.mute').addEventListener('click', () => {
      this.muted = !this.muted
      this.updateAudio()
    })
    this.root.querySelector('.volume').addEventListener('input', (event) => {
      this.volume = Number(event.target.value)
      this.muted = this.volume === 0
      this.updateAudio()
    })
    const fullscreen = this.root.querySelector('.fullscreen')
    fullscreen.hidden = !document.fullscreenEnabled
    fullscreen.addEventListener('click', () => this.run(() => document.fullscreenElement ? document.exitFullscreen() : this.root.requestFullscreen()))
    this.root.querySelector('.player-error button').addEventListener('click', () => location.reload())
    for (const video of this.videos) {
      video.addEventListener('ended', () => this.pause())
      video.addEventListener('error', () => this.fail(new Error(`${video.dataset.language === 'zh' ? '中文' : '英文'}视频解码失败：${video.error?.message || `错误代码 ${video.error?.code}`}`)))
    }
    document.getElementById('players').append(this.root)
    this.selectLanguage(this.language)
    this.tick = this.tick.bind(this)
  }

  async load() {
    if (this.loading) return
    this.loading = true
    try {
      await Promise.all(this.videos.map(async (video) => {
        const response = await fetch(`./assets/${this.id}-${video.dataset.language}.mp4`)
        if (!response.ok) throw new Error(`加载${video.dataset.language === 'zh' ? '中文' : '英文'}视频失败：HTTP ${response.status}`)
        const blob = await response.blob()
        const loaded = mediaEvent(video, 'canplay')
        video.src = URL.createObjectURL(blob)
        video.load()
        await loaded
      }))
      if (this.failed) return
      this.duration = Math.min(...this.videos.map((video) => video.duration))
      this.seek.max = String(this.duration)
      this.ready = true
      this.root.querySelector('.loading').hidden = true
      this.root.querySelector('.video-poster').hidden = true
      this.render()
      this.updateAudio()
      this.tick()
    } catch (error) { this.fail(error) }
  }

  selectLanguage(language) {
    this.language = language
    for (const video of this.videos) video.classList.toggle('active', video.dataset.language === language)
    for (const tab of this.tabs) {
      const active = tab.dataset.language === language
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
    }
    this.root.querySelector('[role=tabpanel]').setAttribute('aria-labelledby', `${this.id}-tab-${language}`)
    this.updateAudio()
  }

  updateAudio() {
    // Mute the previous track before unmuting the next one, including rapid clicks.
    for (const video of this.videos) video.muted = true
    for (const video of this.videos) video.volume = this.volume
    const active = this.videos.find((video) => video.dataset.language === this.language)
    active.muted = this.muted
    const mute = this.root.querySelector('.mute')
    mute.innerHTML = svg(this.muted ? 'muted' : 'volume')
    mute.setAttribute('aria-label', this.muted ? '取消静音' : '静音')
  }

  async start() {
    this.playing = true
    await Promise.all(this.videos.map((video) => video.play()))
  }

  pause() {
    this.playing = false
    for (const video of this.videos) { video.pause(); video.playbackRate = 1 }
    this.render()
  }

  toggle() {
    if (!this.ready || this.busy || this.failed) return
    if (this.playing) { this.pause(); return }
    this.run(async () => {
      if (this.videos.some((video) => video.ended) || this.currentTime >= this.duration - .05) {
        await Promise.all(this.videos.map((video) => seekVideo(video, 0)))
      }
      await this.start()
    })
  }

  async run(action) {
    if (this.busy || this.failed) return
    this.busy = true
    this.render()
    try { await action() } catch (error) { this.fail(error) }
    finally { this.busy = false; this.render() }
  }

  fail(error) {
    this.failed = true
    this.pause()
    this.root.querySelector('.loading').hidden = true
    const alert = this.root.querySelector('.player-error')
    alert.hidden = false
    alert.querySelector('div').textContent = error.message || String(error)
  }

  get currentTime() { return this.videos.find((video) => video.dataset.language === this.language).currentTime }

  renderTime(position) {
    this.clock.textContent = `${time(position)} / ${time(this.duration || 0)}`
    this.seek.style.setProperty('--progress', `${position / (this.duration || 1) * 100}%`)
    this.seek.setAttribute('aria-valuetext', `${time(position)} / ${time(this.duration || 0)}`)
  }

  render() {
    const disabled = !this.ready || this.failed || this.busy
    this.playButton.disabled = disabled
    this.overlay.disabled = disabled
    this.overlay.hidden = this.playing || this.currentTime > .1 || this.failed
    this.seek.disabled = disabled
    for (const tab of this.tabs) tab.disabled = !this.ready || this.failed
    this.playButton.innerHTML = svg(this.playing ? 'pause' : 'play')
    this.playButton.setAttribute('aria-label', this.playing ? '暂停' : '播放')
    if (this.scrubbing === undefined) { this.seek.value = String(this.currentTime); this.renderTime(this.currentTime) }
  }

  tick() {
    if (this.failed) return
    if (this.playing && !this.busy && !this.root.hidden) {
      const active = this.videos.find((video) => video.dataset.language === this.language)
      const standby = this.videos.find((video) => video !== active)
      const drift = active.currentTime - standby.currentTime
      // Keep the muted track decoding beside the audible track. Small drift is
      // corrected gradually, so ordinary language switches do not trigger seeks.
      if (Math.abs(drift) > .2 && !standby.seeking) standby.currentTime = active.currentTime
      standby.playbackRate = Math.abs(drift) > .04 ? 1 + Math.sign(drift) * .04 : 1
      active.playbackRate = 1
      if (active.currentTime >= this.duration) this.pause()
      if (this.scrubbing === undefined) { this.seek.value = String(active.currentTime); this.renderTime(active.currentTime) }
    }
    requestAnimationFrame(this.tick)
  }
}

function mediaEvent(video, event) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer)
      video.removeEventListener(event, ready)
      video.removeEventListener('error', failed)
      if (error) reject(error); else resolve()
    }
    const ready = () => finish()
    const failed = () => finish(new Error(`视频错误：${video.error?.message || video.error?.code}`))
    const timer = setTimeout(() => finish(new Error(`等待视频 ${event} 超时，请重新加载页面。`)), 20000)
    video.addEventListener(event, ready, { once: true })
    video.addEventListener('error', failed, { once: true })
  })
}

async function seekVideo(video, target) {
  if (Math.abs(video.currentTime - target) < .001 && !video.seeking) return
  const seeked = mediaEvent(video, 'seeked')
  video.currentTime = target
  await seeked
}

document.querySelector('.demo-picker').innerHTML = Object.entries(demos).map(([id, demo]) => `
  <button class="sample" type="button" aria-pressed="false" data-sample="${id}">
    <img src="./assets/${id}-poster.jpg" alt="" width="64" height="64">
    <span><strong>${demo.title}</strong><small>${demo.seconds} 秒</small></span>
  </button>`).join('')
const players = Object.fromEntries(Object.entries(demos).map(([id, demo]) => [id, new PairedPlayer(id, demo)]))
function selectDemo(id) {
  for (const [key, player] of Object.entries(players)) {
    if (key !== id) player.pause()
    player.root.hidden = key !== id
  }
  for (const button of document.querySelectorAll('[data-sample]')) {
    const active = button.dataset.sample === id
    button.classList.toggle('is-selected', active)
    button.setAttribute('aria-pressed', String(active))
  }
  document.getElementById('source-link').href = demos[id].source
  players[id].load()
}
for (const button of document.querySelectorAll('[data-sample]')) button.addEventListener('click', () => selectDemo(button.dataset.sample))
const requestedDemo = new URLSearchParams(location.search).get('demo')
selectDemo(Object.hasOwn(demos, requestedDemo) ? requestedDemo : 'jensen')
