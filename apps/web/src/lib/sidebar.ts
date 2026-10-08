const STORAGE_KEY = "youdub-sidebar"

// 在首帧绘制前恢复侧边栏折叠状态；样式通过 sidebar-collapsed 变体响应 <html data-sidebar>。
export const SIDEBAR_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("${STORAGE_KEY}")==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(_){}})()`

export function setSidebarCollapsed(collapsed: boolean) {
  document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded"
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "expanded")
  } catch {
    // 存储不可用时仅在当前页面生效。
  }
}
