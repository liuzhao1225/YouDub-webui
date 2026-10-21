// Invoked only by the native launchers' explicit --smoke-ready mode.
// This exercises the shipped browser bundle and authenticated plugin pages.
(() => {
  const result = window.__youdubReadySmoke = { state: 'running', pages: [] }
  const fail = error => { result.state = 'failed'; result.error = String(error?.stack || error) }
  window.addEventListener('error', event => fail(event.error || event.message))
  window.addEventListener('unhandledrejection', event => fail(event.reason))
  const sleep = () => new Promise(resolve => setTimeout(resolve, 100))
  async function until(label, check) {
    const end = Date.now() + 120000
    while (Date.now() < end) {
      if (result.state === 'failed') throw new Error(result.error)
      const value = await check()
      if (value) return value
      await sleep()
    }
    throw new Error(`${label} timed out: ${document.body.innerText.slice(-4000)}`)
  }
  async function json(path) {
    const response = await fetch(path, { credentials: 'same-origin', signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${await response.text()}`)
    return response.json()
  }
  async function page(path, heading) {
    const link = await until(`Navigation ${path}`, () => document.querySelector(`a[href="${path}"]`))
    link.click()
    await until(`Page ${path}`, () => location.pathname.startsWith(path) && heading.test(document.querySelector('main h1')?.textContent || ''))
    result.pages.push(location.pathname)
  }
  const settingsDialog = () => document.querySelector('[role="dialog"]')
  const button = (root, label) => [...root.querySelectorAll('button')].find(element => element.getClientRects().length && label.test(element.getAttribute('aria-label') || element.textContent.trim()))
  async function settingsSection(section, heading) {
    const choice = await until(`Settings category ${section}`, () => {
      const navigation = settingsDialog()?.querySelector('nav')
      return navigation && button(navigation, heading)
    })
    choice.click()
    await until(`Settings ${section}`, () => location.pathname === `/settings/${section}` && heading.test(settingsDialog()?.querySelector('section h1')?.textContent || ''))
    result.pages.push(location.pathname)
  }
  void (async () => {
    await until('Base environment', async () => {
      const setup = await json('/api/setup')
      if (setup.phase === 'failed') throw new Error(setup.error || 'Base environment preparation failed')
      return setup.phase === 'ready'
    })
    // Use the actual onboarding action; this does not add a test bypass to Host.
    const later = await until('Translation onboarding', () => [...document.querySelectorAll('button')].find(button => /^(Configure later|稍后配置|後で設定)$/.test(button.textContent.trim())))
    later.click()
    await until('Workbench', () => document.querySelector('main input[type="file"]') && /Make every video speak|让视频说|動画を、/.test(document.querySelector('main h1')?.textContent || ''))
    result.pages.push('/')
    const manifest = await json('/api/v2/client-manifest')
    if (!manifest.modules?.some(module => module.access === 'authenticated')) throw new Error('Authenticated plugin manifest is empty')
    result.modules = manifest.modules.map(module => module.id)
    await page('/tasks', /^(Library|任务库|ライブラリ)$/)
    await page('/workflows', /^(Workflows|工作流|ワークフロー)$/)
    await until('Workflow templates', () => document.querySelector('a[href="/workflows/youdub.subtitles"]'))
    const background = document.querySelector('main')
    const settings = await until('Settings button', () => button(document, /^(Settings|设置|設定)$/))
    settings.click()
    await until('Settings dialog', () => location.pathname === '/settings/general' && /^(General|通用|一般)$/.test(settingsDialog()?.querySelector('section h1')?.textContent || ''))
    result.pages.push(location.pathname)
    const settingsHistoryLength = history.length
    await settingsSection('resources', /^(Environment & models|环境与模型|環境とモデル)$/)
    await until('Environment resources', () => settingsDialog()?.querySelector('section')?.textContent.includes('Python 3.12'))
    await settingsSection('models', /^(Models|模型|モデル)$/)
    await until('Provider directory and editor', () => {
      const content = settingsDialog()?.querySelector('section')
      return content?.querySelector('[role="tab"][aria-selected="true"]') && content.querySelector('select option') && content.querySelector('input[type="password"]')
    })
    if (history.length !== settingsHistoryLength) throw new Error('Settings categories added browser history entries')
    const close = await until('Close settings', () => settingsDialog() && button(settingsDialog(), /^(Close settings|关闭设置|設定を閉じる)$/))
    close.click()
    await until('Return to workflows', () => location.pathname === '/workflows' && !settingsDialog())
    if (document.querySelector('main') !== background) throw new Error('Settings navigation remounted the background page')
    if (result.state === 'failed') throw new Error(result.error)
    result.state = 'completed'
  })().catch(fail)
})()
