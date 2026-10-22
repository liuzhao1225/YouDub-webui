# Harness 版前端开发

当前桌面前端由 DSH 的 Renderer、ModuleLoader、Slots、Layout 和 Store 承载。原 YouDub 的页面组件继续在 `apps/web/src` 中维护，`apps/harness/src/frontend` 提供官方服务与原组件属性之间的接线。

## 入口与构建方式

[`package.json`](../package.json) 的 `dsh.client` 声明客户端所需官方模块，[`src/client.jsx`](../src/client.jsx) 的 `inject` 声明运行时服务。官方 Loader 满足依赖后调用 `apply(ctx)`。

[`build.mjs`](../build.mjs) 将 Client 打成 `dist/client.js`，使用 `window.__ModuleLoader__.load` 注册 bundle。React、React DOM、官方 Cordis、Store、Slots 和 primitives 作为共享模块，由运行时提供。当前 Harness 侧依赖 React `18.3.1`；`apps/web/package.json` 中 React 19/Vite 8 用于保留的组件测试，业务组件接入时必须兼容 Harness 的 React 版本。

修改桌面 UI 后执行根目录 `npm run build:youdub`，再重启当前 YouDub 开发实例。当前脚本使用显式构建，不提供桌面 HMR。`npm run dev:web` 使用同一 Harness Host 与前端架构提供浏览器开发入口；原生文件框、窗口和退出行为需要在 Electron 中验收。

## 修改位置

| 要修改的内容 | 首选位置 | 接入说明 |
| --- | --- | --- |
| 原首屏、动态 Logo、大标题、视频输入 | [`studio.tsx`](../../web/src/plugin/builtin/studio.tsx)、[`brand-mark.tsx`](../../web/src/components/brand/brand-mark.tsx) | [`studio-page.tsx`](../src/frontend/studio-page.tsx) 直接导入并传入 `useFeatures()` |
| 任务库、任务详情 | [`library.tsx`](../../web/src/plugin/builtin/library.tsx)、[`task-pages.tsx`](../src/frontend/task-pages.tsx) | 保留原查询、操作和结果组件 |
| 工作流库、画布、节点配置 | [`workflows.tsx`](../../web/src/plugin/builtin/workflows.tsx)、[`workflow-canvas.tsx`](../../web/src/plugin/builtin/workflow-canvas.tsx)、[`workflow-settings.tsx`](../../web/src/plugin/builtin/workflow-settings.tsx) | React Flow 作为业务画布使用，页面接入在 `workflow-pages.tsx` |
| 字幕、翻译与音频订正 | [`workflow-task.tsx`](../../web/src/plugin/builtin/workflow-task.tsx) | 使用已有草稿、保存、确认和节点详情合同 |
| 侧栏、主区域、官方设置入口 | [`client.jsx`](../src/client.jsx) | 通过官方 Layout 与 Slots 装配 |
| 通用控件属性转换 | [`ui/`](../../web/src/components/ui)、[`harness-primitives.ts`](../../web/src/components/ui/harness-primitives.ts)、[`dialog.tsx`](../src/frontend/dialog.tsx)、[`popover.tsx`](../../web/src/components/ui/popover.tsx) | 使用官方交互实现，转换原业务组件需要的属性 |
| 产品布局 | [`style.css`](../src/style.css) | YouDub 页面与侧栏范围内的布局规则 |
| 色彩、品牌动效 | [`globals.css`](../../web/src/app/globals.css)、[`build.mjs`](../build.mjs) | 提取原主题变量和动效，映射到官方 theme tokens |
| 模型与扩展页面 | [`translation-setup.tsx`](../src/frontend/translation-setup.tsx)、[`plugins.tsx`](../src/frontend/plugins.tsx) | 使用官方 ModelsSection、PluginManagerPage 和对应控制器 |

完整元素对应见[前端映射](../FRONTEND-MAPPING.md)。修改已有能力时直接进入原文件，避免复制第二份相同行为。

## 页面与插槽

`client.jsx` 的装配包含：

1. 注册语言、插件目录和模型引导。
2. 用官方 `defineStore` 保存当前页面路径和导航错误。
3. 注册临时 `root` 插槽，承载原 `SetupGate`；环境和模型引导结束后释放该插槽。
4. 将 YouDub 侧栏接到 `sidebar`，将页面容器接到 `main`。
5. 将业务页面挂到 `youdub.page`，将节点编辑器和详情组件挂到对应领域插槽。

内置页面在 `routes` 中同时声明 `path`、`key` 和 `component`。原 `resolveRoute` 处理路径参数与静态路由优先级；页面按完整路径保持原组件生命周期。扩展页面可以在 `youdub.page` 使用以 `/` 开头的路由作为 key。主面板切换通过 `ctx.layout.selectPanel`，业务导航通过注入的 `navigate`。

| 插槽 | 用途 |
| --- | --- |
| `youdub.page` | 页面路由 |
| `youdub.navigation` | 扩展导航入口 |
| `youdub.config.editors` | 业务配置编辑器 |
| `youdub.task.detail.panels` / `actions` | 任务详情区和操作 |
| `youdub.workflow.node.editors` / `details` | 节点配置与结果详情 |
| `youdub.settings.sections` | 业务设置区 |

节点详情插槽的完整实例在[graph-text-review 客户端](../test/fixtures/graph-text-review/src/client.jsx)：它接收 `detail`、`outputs`、`draft`、`readOnly`、`onDraftChange`、`navigate`，将订正交还原任务页面保存。外部插件通过自己的 context 注册插槽，卸载时由官方生命周期释放。

## 控件复用与框架入口

已有业务组件继续导入 `@/components/ui/*`。基础控件在源码中直接复用 Harness，测试和桌面使用同一份属性转换。构建仍保留下列明确边界：

| 原组件依赖 | Harness 接入 |
| --- | --- |
| Button、Input、Select、Tooltip、Switch、Tag、Segmented 等 | `components/ui/*` → `harness-primitives.ts`；测试载入官方源码，Desktop 连接官方共享运行时 |
| Base UI Dialog 的旧调用形状 | `frontend/dialog.tsx` → 官方 Modal；快捷字段浮层已直接使用共享 `ui/popover.tsx` 和官方 Menu |
| 原 `plugin/sdk` 的导航与辅助接口 | `frontend/sdk.tsx` → 注入的页面导航与原领域纯函数 |
| `zustand/vanilla`（限原 Web 源文件） | `frontend/store.ts` → 官方 `createSnapshotStore` |
| 原 i18n、theme、clipboard、asset-url | 对应 `frontend/*` 绑定 |
| 图标 | `frontend/icons.tsx` 中的映射 |

在 Harness 专属组件中可以直接导入 `@deepseek-ai/dsh-client-ui-primitives`。原 YouDub 的通用控件属性差异在原 `components/ui/*` 统一处理；焦点、键盘、Portal、弹层和滚动条遵循官方实现。业务画布、视频播放器与逐句编辑继续使用现有领域组件。

菜单测试通过可见菜单项选择，保留原业务结果、字段类型、禁用与草稿断言。`controls.test.tsx` 检查键盘选项跳转、关闭和焦点返回；实际 Host 页面证据见[统一控件验证](evidence/refactor-unified-controls.json)。

不要为新页面创建额外 React root、Cordis 根、路由容器或模型配置表单。构建脚本仅对明确的导入边界进行替换；新增依赖后运行活动模块检查，确认没有带入旧平台实现或第二份 React。

## 状态、请求与错误

[`runtime.tsx`](../src/frontend/runtime.tsx) 的 `createFeatures` 复用原 `QueryClient`、`StudioDraftStore` 和 `WorkflowResourceChecks`，为页面提供 `request`、`navigate`、`useQuery`、`useWorkflowDocuments`、`useWorkflowResources`、`useSlot` 等能力。

普通业务请求沿用逻辑 API 路径，例如读取 `/api/v2/tasks`。`request` 将其包装成：

```json
{
  "method": "GET",
  "path": "/api/v2/tasks"
}
```

这个包发送到物理端点 `POST /api/youdub/v2`，由官方 Connection 准入。`FormData` 走 `/api/youdub/upload`；媒体与下载通过 `/api/youdub/file?path=...`。页面无需保存认证 token 或创建自己的 HTTP 服务。官方模型、设置和插件页面继续使用各自 Remote 服务。

查询状态通过 `useSyncExternalStore` 订阅。模型、设置和凭据变更事件会使资源检查与目录查询失效。保持原页面的错误、loading、修订冲突和离开保护语义；提交失败时向用户显示业务错误，不将失败请求变成空列表或成功提示。

工作流节点的“自动下一步”属于持久配置。校对页面修改草稿，保存与确认沿原任务 API 进行；组件局部状态不能推进后端节点。详见[后端工作流合同](BACKEND-DEVELOPMENT.md#任务与节点语义)。

## 主题、布局与动效

构建从原 `globals.css` 提取明暗色变量，将其映射到 `--dsw-alias-*`；运行时通过 `ctx.theme.overrideTokens` 应用。`eq`、`shimmer`、`rise`、`drift` 动效从原源码提取并加 YouDub 前缀。修改品牌视觉时保持这一来源关系。

原业务 Tailwind utilities 与 React Flow CSS 会进入 Client bundle；全局 reset 和原 `:root`/`.dark` 主题块经过构建处理，防止覆盖官方应用壳。产品几何样式限定在 `.yd` 等业务范围。

布局调整优先使用现有容器和间距 token。`--yd-window-top-clearance` 在根节点保留官方 `--dsh-frame-top-clearance` 的窗口安全区。侧栏展开时，macOS 窗口按钮只在侧栏留位，主区域将官方顶部留位设为零；收起侧栏后恢复主区域安全区。Windows 由官方 frame 为标题栏留位。主内容滚动由 `.yd-main` 承担，侧栏采用固定容器布局。不要用额外固定高度或全局滚动条样式补偿单张截图。

## 多语言与验证

界面文案使用稳定键和 `useText()`；语言偏好由官方 locale 管理，在官方设置的语言项选择。新增文案同步补齐 `apps/web/src/locales`，官方设置的补充字典放在 `apps/harness/locales`，具体步骤见[多语言维护](LOCALIZATION.md)。

按改动范围执行检查：

```sh
npm --prefix apps/harness run check:locales
npm --prefix apps/web test -- src/plugin/workflow-task.test.tsx
npm run build:youdub
npm --prefix apps/harness run check:composition
```

示例测试文件应替换为实际修改组件的测试。纯文档修改无需运行 UI 构建与测试。涉及官方组件、设置或桌面布局时，在实际 Harness 页面检查明暗主题、中英日、窄窗口、弹层焦点、滚动和重启后的偏好；涉及文件选择、保存框和窗口操作时使用原生 Electron 验收。视频功能另需真实任务和产物校验。
