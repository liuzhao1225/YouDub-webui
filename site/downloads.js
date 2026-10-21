const select = document.querySelector('#release-version')
const list = document.querySelector('#release-downloads')
const status = document.querySelector('#download-status')
try {
  const response = await fetch('./releases.json', { cache: 'no-cache' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const releases = await response.json()
  if (!releases.length) throw new Error('没有可下载的正式版本')
  const marked = releases.filter(release => release.isLatest === true)
  if (releases.some(release => release.isLatest !== undefined && typeof release.isLatest !== 'boolean') || marked.length > 1 || (!marked.length && releases.some(release => release.isLatest !== undefined))) throw new Error('最新版标记无效')
  const latestRelease = marked[0] ?? releases[0]
  for (const [index, release] of releases.entries()) {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = `${release.version}${release === latestRelease ? ' · 最新版' : ''}`
    option.selected = release === latestRelease
    select.append(option)
  }
  function show() {
    const release = releases[Number(select.value)]
    const latest = release === latestRelease
    const releaseUrl = latest ? 'https://github.com/liuzhao1225/YouDub-webui/releases/latest' : release.url
    list.replaceChildren()
    for (const platform of release.platforms) {
      const files = latest ? platform.latest : platform
      const selected = platform.installer ? files?.installer : files
      const card = document.createElement('article')
      const title = document.createElement('h3')
      title.textContent = platform.name
      const requirements = document.createElement('p')
      requirements.textContent = platform.requirements
      const download = document.createElement('a')
      download.className = 'button primary'
      download.href = selected?.url || releaseUrl
      download.textContent = `下载 ${platform.name} ${platform.id === 'macos-arm64' ? 'DMG' : platform.installer ? '安装包 EXE' : 'ZIP'} ↓`
      const checksum = document.createElement('a')
      checksum.className = 'text-link'
      checksum.href = selected?.checksum || releaseUrl
      checksum.textContent = 'SHA-256 校验文件'
      card.append(title, requirements, download, checksum)
      if (platform.installer) {
        const portable = document.createElement('a')
        portable.className = 'text-link'
        portable.href = files?.url || releaseUrl
        portable.textContent = 'ZIP 便携版'
        card.append(portable)
      }
      if (platform.id === 'windows-x64') {
        const note = document.createElement('p')
        note.textContent = `${platform.installer ? '双击安装' : '完整解压后运行'} · 需 WebView2 · 暂未签名`
        card.append(note)
      }
      list.append(card)
    }
    document.querySelector('#release-notes').href = releaseUrl
  }
  select.addEventListener('change', show)
  for (const link of document.querySelectorAll('a[href="#download"]')) {
    link.addEventListener('click', () => { select.value = String(releases.indexOf(latestRelease)); show() })
  }
  select.disabled = false
  show()
  status.hidden = true
} catch (error) {
  status.textContent = `下载列表加载失败（${error.message}），请通过 GitHub Releases 下载。`
  status.setAttribute('role', 'alert')
}
