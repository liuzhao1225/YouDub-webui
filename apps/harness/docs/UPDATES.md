# 桌面更新与官网下载

## 当前行为

安装版启动时自动检查；之后沿用 Harness 的 10 分钟周期、20% 抖动和最多 1 小时失败退避。回到前台及系统唤醒共享同一个检查期限；手动检查立即执行并复用正在进行的请求。失败保留可见状态和原始错误，下一次定时检查成功后才清除。源码开发启动不自动联网，仍可手动检查。

侧栏底部使用 Harness `DesktopUpdateIndicator`，完全收起后使用原 `DesktopUpdateBadge`。macOS 顶栏 `HeaderLeadingControls` 增加可选徽标位置，通过同一个插槽工厂复用徽标，避免随侧栏隐藏。应用菜单和设置中的版本行均提供“检查更新”。发现新版本后，由用户点击下载按钮，在系统浏览器打开该版本对应的 macOS ARM64 DMG 或 Windows x64 Inno EXE；历史版本允许 ZIP。应用不会自动下载、安装或重启，不会中断媒体任务。

更新检查在 Electron 主进程执行，独立于 Python、资源准备和 Host。preload 只暴露状态、打开更新面板及事件订阅；主进程验证调用窗口与来源。下载地址由固定发布列表解析，不接受渲染进程提供的 URL。

## 复用来源

上游提交：`687f282e8625c6b8d11ff58211a90524be2e4317`。

- [Harness 更新调度器](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/src/update-schedule.ts)：复制保留，类型依赖缩小为检查接口，调度算法保持原实现。
- [Harness 桌面更新说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#updates)：沿用自动检查、前台/唤醒触发、原生菜单与状态提示。
- [Harness 发版说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/publishing/README.md)：安装包先发布、更新入口最后切换，并保留版本化下载和最新版本别名。

YouDub 使用现有 `packages/builtin/src/updates.ts` 检查 GitHub Pages 发布列表，保留版本比较、平台匹配及仓库地址验证。本次只增加一个上游源码文件，包数量仍为 80。未引入上游自动安装、强制更新策略、COS 发布工具或完整更新协调器。

## 发布链路

1. `release.yml` 继续复用通过 CI 的同一候选产物，完成 macOS 签名、公证并准备 Windows 安装包。
2. 校验本地包，创建 GitHub 草稿 Release，上传版本化文件、最新版本别名及各自 SHA-256。
3. 读回所有上传文件并校验，再将草稿公开并标记为 Latest。上传或校验失败时停止发布，草稿与错误保留。
4. 成功的发布工作流触发 `pages.yml`。从 GitHub 已公开 Release 及 Latest 生成 `site/releases.json`，与官网一起部署。
5. `verify-update-feed.mjs` 回读公开列表，与部署产物比较；不同或不可访问时明确失败。

官网与客户端共用 [releases.json](https://liuzhao1225.github.io/YouDub-webui/releases.json)，旧版本始终使用版本化 URL。客户端只采用发布者标记的 Latest，不因历史版本号更高而覆盖选择，也不降级。官网固定下载别名指向同一公开版本。

## 定向检查

```sh
node --test apps/harness/test/desktop-updates.test.mjs
node --import tsx --test packages/builtin/test/updates.test.ts
npm run test:downloads
npm run build:framework
npm run build:youdub
```

桌面行为检查使用隔离 profile 和模拟发布列表，覆盖自动检测、折叠徽标、设置入口、用户确认后打开下载，以及原始网络错误。公开列表另行只读验证。本地构建和模拟升级不等于新安装包已发布。

2026-10-23：13 项更新/发布列表测试、19 项 Harness 提示与侧栏测试通过；框架和产品构建、类型、装配及语言检查通过。原生浅色、深色、完全折叠后的提示和设置入口已截图核对，模拟 HTTP 503 保留原始错误。公开列表与 GitHub Release 生成结果一致，macOS / Windows 均识别到 v0.0.8。本轮未打包、创建新版本或部署官网；公开发布流程的改动将在下一次正式发版生效。
