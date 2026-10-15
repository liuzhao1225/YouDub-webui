const select = document.querySelector('#release-version')
const list = document.querySelector('#release-downloads')
const status = document.querySelector('#download-status')
try {
  const response = await fetch('./releases.json', { cache: 'no-cache' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const releases = await response.json()
  if (!releases.length) throw new Error('没有可下载的正式版本')
  for (const [index, release] of releases.entries()) {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = `${release.version}${index === 0 ? ' · 最新版' : ''}`
    select.append(option)
  }
  function show() {
    const release = releases[Number(select.value)]
    list.replaceChildren()
    for (const platform of release.platforms) {
      const card = document.createElement('article')
      const title = document.createElement('h3')
      title.textContent = platform.name
      const requirements = document.createElement('p')
      requirements.textContent = platform.requirements
      const download = document.createElement('a')
      download.className = 'button primary'
      download.href = platform.url
      download.textContent = `下载 ${platform.name} ${platform.id === 'macos-arm64' ? 'DMG' : 'ZIP'} ↓`
      const checksum = document.createElement('a')
      checksum.className = 'text-link'
      checksum.href = platform.checksum
      checksum.textContent = 'SHA-256 校验文件'
      card.append(title, requirements, download, checksum)
      if (platform.id === 'windows-x64') {
        const note = document.createElement('p')
        note.textContent = '完整解压后运行 · 需 WebView2 · 暂未签名'
        card.append(note)
      }
      list.append(card)
    }
    document.querySelector('#release-notes').href = release.url
  }
  select.addEventListener('change', show)
  for (const link of document.querySelectorAll('a[href="#download"]')) {
    link.addEventListener('click', () => { select.value = '0'; show() })
  }
  select.disabled = false
  show()
  status.hidden = true
} catch (error) {
  status.textContent = `下载列表加载失败（${error.message}），请通过 GitHub Releases 下载。`
  status.setAttribute('role', 'alert')
}
