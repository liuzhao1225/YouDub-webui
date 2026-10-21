# YouDub 模型设置与首次 LLM 配置

## 2026-10-21 实施

- `cordis.patch.yml` 禁用 `deepseek-account`、`account-controller`、`llm-deepseek-account`、`llm-deepseek`、`product-analytics`、`desktop-product-telemetry`。保留官方 `llm-pi-ai`、Credentials、Settings 和模型设置页面。默认不激活任何 DeepSeek 提供商；用户仍可通过官方提供商目录自行添加 DeepSeek。
- 账号和默认提供商来自官方 base/web 产品组合。既有桌面 YouDub 私有 home 的 Credentials 文档存在 `deepseek-account-platform/default` 记录；检查只读取记录名，没有输出密钥或令牌。禁用账号链后不加载该服务，旧凭据文件保留原样，没有登出或删除原 Harness 账号。
- 原 `TranslationSetupView` 直接提取到 `apps/web/src/components/translation-setup-view.tsx`，原 web 入口继续复用。`TranslationSetupController` 增加 Request 注入，Harness 模式通过官方 Connection 转发 API，不运行旧 auth-session。
- `src/frontend/translation-setup.tsx` 直接导入未修改的官方 `ModelsSection`、`ModelsSettingsStore`、operations 和 schema operations。仅映射产品自有 child slot 名称，避免与官方设置页的全局 slot 声明冲突。
- 首次配置维持原顺序：环境准备 → LLM 配置 → 工作台。LLM 可稍后配置，延后状态持久化在官方配置服务的 YouDub preferences。提供商保存后从后端 catalog 刷新可用性，点击“继续”进入工作台。读写期间禁用继续/跳过。

## 已验证

- 独立临时 profile，端口 3092，实际打开官方设置页：初始仅显示模型标题、说明和“添加模型提供商”，没有 DeepSeek 账号或默认 DeepSeek 行。添加按钮仍打开官方内置目录和自定义 API 编辑界面。验证期间未重启用户的 3087 或桌面。
- 截图：`/tmp/youdub-model-settings-empty.png`。
- `apps/web` 的 translation-setup 与 onboarding 两个测试文件：13 项通过。覆盖注入 Connection 后不调用旧 auth-session、可用提供商保存后等待继续、稍后配置持久化、原错误及关闭行为。
- `apps/web` TypeScript 检查通过。
- `node apps/harness/baselines/vendor.mjs --verify` 通过：331 个官方包、8951 个文件，源码 commit `687f282e8625c6b8d11ff58211a90524be2e4317`，清单 SHA-256 `7896b846abf9bd1300da3bd05282c21a5afa528d9c14c922122fb017e74cd729`。

## 待统一构建后的主线验收

- 真实用户桌面 profile 重启后的空默认模型页及旧账号记录不再参与模型列表。
- 新增首次 LLM 配置页面的完整渲染、官方添加/编辑、保存后继续，以及稍后配置后重新打开的实际行为。此前 3092 渲染验证使用构建前客户端，仅验证产品组合删除默认项。
- 原 YouDub 编辑器支持向外层报告未保存草稿；官方 `ModelsSection` 没有公开 dirty 回调。当前桥接保留保存中保护，尚未验证在官方编辑器有未保存草稿时外层“稍后配置”是否应保持原阻止离开的行为。未修改上游或加入 DOM 状态探测。

隔离服务与临时浏览器标签页已关闭。主线统一构建后继续以上验收。
