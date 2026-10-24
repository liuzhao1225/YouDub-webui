# YouDub组件源码索引

2026-10-24 · 按实际组件导出盘点。平台适配与业务组件分别保留职责；具体契约见[视觉与组件规范](harness-visual-spec.md)。

| 源文件 | 导出组件/入口 |
| --- | --- |
| [apps/web/src/components/brand/brand-mark.tsx](../../apps/web/src/components/brand/brand-mark.tsx) | BrandMark |
| [apps/web/src/components/inline-alert.tsx](../../apps/web/src/components/inline-alert.tsx) | InlineAlert |
| [apps/web/src/components/localize-task-config.tsx](../../apps/web/src/components/localize-task-config.tsx) | TaskOptions, TaskConfigForm |
| [apps/web/src/components/page-layout.tsx](../../apps/web/src/components/page-layout.tsx) | PageContainer, Page, PageHeader, PageTitle |
| [apps/web/src/components/resource-row.tsx](../../apps/web/src/components/resource-row.tsx) | ResourceRow |
| [apps/web/src/components/section-card.tsx](../../apps/web/src/components/section-card.tsx) | SectionCard |
| [apps/web/src/components/settings-resources.tsx](../../apps/web/src/components/settings-resources.tsx) | SettingsResources |
| [apps/web/src/components/setup-diagnostics.tsx](../../apps/web/src/components/setup-diagnostics.tsx) | SetupDiagnostics |
| [apps/web/src/components/setup-gate.tsx](../../apps/web/src/components/setup-gate.tsx) | SetupGate |
| [apps/web/src/components/setup-installation.tsx](../../apps/web/src/components/setup-installation.tsx) | SetupInstallation |
| [apps/web/src/components/setup-page.tsx](../../apps/web/src/components/setup-page.tsx) | SetupPage：首次准备与服务配置的共享品牌页头、表单边界 |
| [apps/web/src/components/setup-screen.tsx](../../apps/web/src/components/setup-screen.tsx) | SetupScreen |
| [apps/web/src/components/task-cover.tsx](../../apps/web/src/components/task-cover.tsx) | TaskCover |
| [apps/web/src/components/translation-setup-view.tsx](../../apps/web/src/components/translation-setup-view.tsx) | TranslationSetupView |
| [apps/web/src/components/ui/disclosure.tsx](../../apps/web/src/components/ui/disclosure.tsx) | Disclosure |
| [apps/web/src/components/ui/input.tsx](../../apps/web/src/components/ui/input.tsx) | Input |
| [apps/web/src/components/ui/native-select.tsx](../../apps/web/src/components/ui/native-select.tsx) | NativeSelect, Choice |
| [apps/web/src/components/ui/progress.tsx](../../apps/web/src/components/ui/progress.tsx) | Progress |
| [apps/web/src/components/ui/segmented.tsx](../../apps/web/src/components/ui/segmented.tsx) | Segmented |
| [apps/web/src/components/ui/surface.tsx](../../apps/web/src/components/ui/surface.tsx) | Surface, surfaceVariants |
| [apps/web/src/components/ui/switch.tsx](../../apps/web/src/components/ui/switch.tsx) | Switch |
| [共享 Textarea](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Textarea.tsx) | YouDub 多行表单适配，复用 Harness InlineEditor 样式；[Web 入口](../../apps/web/src/components/ui/textarea.tsx)直接转导出，外部插件通过 `@deepseek-ai/dsh-client-ui-primitives` 复用 |
| [apps/web/src/components/video-player.tsx](../../apps/web/src/components/video-player.tsx) | VideoPlayer |
| [apps/web/src/plugin/builtin/library.tsx](../../apps/web/src/plugin/builtin/library.tsx) | Library, TaskDetail, name, inject, apply |
| [apps/web/src/plugin/builtin/localize-editor.tsx](../../apps/web/src/plugin/builtin/localize-editor.tsx) | LocalizeEditor, name, inject, apply |
| [apps/web/src/plugin/builtin/media-upload.tsx](../../apps/web/src/plugin/builtin/media-upload.tsx) | UploadSlot, LaunchCard |
| [apps/web/src/plugin/builtin/schema-form.tsx](../../apps/web/src/plugin/builtin/schema-form.tsx) | schemaProblems, defaultConfig, validateConfig, ConfigEditor, useEditorSupported |
| [apps/web/src/plugin/builtin/studio.tsx](../../apps/web/src/plugin/builtin/studio.tsx) | Studio, name, inject, apply |
| [apps/web/src/plugin/builtin/task-status.tsx](../../apps/web/src/plugin/builtin/task-status.tsx) | ACTIVE_STATUSES, STATUS_LABELS, taskDisplayName, TaskState, TaskProgress |
| [apps/web/src/plugin/builtin/workflow-canvas.tsx](../../apps/web/src/plugin/builtin/workflow-canvas.tsx) | WorkflowCanvas, createNode |
| [apps/web/src/plugin/builtin/workflow-errors.tsx](../../apps/web/src/plugin/builtin/workflow-errors.tsx) | workflowDiagnostics, WorkflowDiagnostics |
| [apps/web/src/plugin/builtin/workflow-guard.tsx](../../apps/web/src/plugin/builtin/workflow-guard.tsx) | useUnsavedChanges |
| [apps/web/src/plugin/builtin/workflow-options.tsx](../../apps/web/src/plugin/builtin/workflow-options.tsx) | optionPillClassName, WorkflowOptions |
| [apps/web/src/plugin/builtin/workflow-rerun.tsx](../../apps/web/src/plugin/builtin/workflow-rerun.tsx) | WorkflowRerun |
| [apps/web/src/plugin/builtin/workflow-resources.tsx](../../apps/web/src/plugin/builtin/workflow-resources.tsx) | WorkflowResources |
| [apps/web/src/plugin/builtin/workflow-run.tsx](../../apps/web/src/plugin/builtin/workflow-run.tsx) | WorkflowRun |
| [apps/web/src/plugin/builtin/workflow-settings.tsx](../../apps/web/src/plugin/builtin/workflow-settings.tsx) | NodePluginBoundary, SynthesizeNodeEditor, NodeSettings, GraphPorts |
| [apps/web/src/plugin/builtin/workflow-task.tsx](../../apps/web/src/plugin/builtin/workflow-task.tsx) | TaskWorkflowPanel, TaskNodePage, TranscriptNodeDetails, TranslationNodeDetails |
| [apps/web/src/plugin/builtin/workflows.tsx](../../apps/web/src/plugin/builtin/workflows.tsx) | WorkflowLibrary, WorkflowRoute, GraphStudio, name, inject, apply |
| [apps/harness/src/frontend/i18n.tsx](../../apps/harness/src/frontend/i18n.tsx) | LanguageProvider, useI18n, useText |
| [apps/harness/src/frontend/plugins.tsx](../../apps/harness/src/frontend/plugins.tsx) | applyPlugins |
| [apps/harness/src/frontend/resource-pages.tsx](../../apps/harness/src/frontend/resource-pages.tsx) | ResourcesPage |
| [apps/harness/src/frontend/runtime.tsx](../../apps/harness/src/frontend/runtime.tsx) | FeatureProvider, useFeatures, domainSlots, createFeatures |
| [apps/harness/src/frontend/sdk.tsx](../../apps/harness/src/frontend/sdk.tsx) | bindComponent, NavigationContext, Link |
| [apps/harness/src/frontend/studio-page.tsx](../../apps/harness/src/frontend/studio-page.tsx) | StudioPage |
| [apps/harness/src/frontend/task-pages.tsx](../../apps/harness/src/frontend/task-pages.tsx) | TasksPage, TaskPage, NodePage |
| [apps/harness/src/frontend/theme.tsx](../../apps/harness/src/frontend/theme.tsx) | ThemeProvider, useTheme, ThemeToggle |
| [apps/harness/src/frontend/translation-setup.tsx](../../apps/harness/src/frontend/translation-setup.tsx) | applyTranslationSetup, TranslationSetup |
| [apps/harness/src/frontend/workflow-pages.tsx](../../apps/harness/src/frontend/workflow-pages.tsx) | WorkflowsPage, WorkflowPage |

共享控件由 `apps/web/src/components/ui/` 提供业务属性适配；`harness-primitives.ts` 是框架依赖入口，桌面构建映射到当前 Harness 客户端加载器持有的官方模块。原 `apps/harness/src/frontend/controls.tsx`、`dialog.tsx`、`popover.tsx` 已移除。


## 2026-10-24 客户端复用审查

覆盖首次安装、环境准备、模型准备、服务配置、工作台、任务库、任务详情、节点结果、工作流目录/画布/配置、资源、插件和设置。官网是独立静态站点，不引入桌面 React 运行时。

| 场景 | 共享实现与本次处理 |
| --- | --- |
| 环境、模型、资源、任务及节点进度 | 全部直接引用 `ui/progress.tsx`；保留粉→蓝渐变、完成/暂停语义和未知总量状态。删除 `ResourceProgress` 别名及未使用的旧资源行。 |
| 资源状态与动作 | `ResourceRow` 服务首次准备、资源页和工作流资源；旧 `EnvironmentSteps`、`ModelDownloadRow` 已删除。 |
| 主次按钮、下载入口 | `Button` 复用 Harness；链接动作使用同源 `buttonVariants`，保留原生下载/新窗口行为。已修正文件与节点音频下载入口。 |
| 卡片、诊断、表单与空态 | `Surface` 统一表面；卡片链接使用 `surfaceVariants({ interactive: true })`，共享悬停与键盘焦点。工作台、任务库、启动输入组、诊断和画布连接工具条已迁移。 |
| 操作失败与插件错误 | 共用 `InlineAlert`；移除未使用的 Harness 适配层副本。目录字段错误保留 `aria-describedby` 对应的就地提示。 |
| 视频倍速菜单 | `VideoPlayer` 直接使用 Harness `Menu`，删除手写菜单及桌面播放器替代入口。普通窗口使用 portal 避免窄播放器裁切，全屏时在播放器内部渲染；键盘、焦点与外部关闭交给 Harness。 |
| 输入、下拉、开关、标签、折叠与弹窗 | 沿用现有 Harness 适配组件。`NativeSelect` 与 `Select` 保留不同业务调用契约，底层均为同一个 Harness `Menu`/`Button`。 |
| 侧栏、主题与语言 | Harness 是唯一产品入口；删除无调用方的旧 `SidebarLink`、Web `ThemeToggle`、`LanguageSwitcher` 及准备页临时主题分支。 |

保留的业务控件：视频定位与音量使用可操作的原生 `range`；上传使用原生文件输入；工作流节点/边由 React Flow 管理；字幕、音频和诊断内容保留各自的数据与行为。它们不属于同一种进度显示或基础表单控件。


本轮验证：85 个相关组件/业务交互测试通过；播放器菜单修正后针对性复跑通过；TypeScript 与产品构建通过；`check:composition` 确认客户端从 Harness 加载器复用 `ui-primitives`，没有把另一份基础控件实现打入产品包。实渲染检查包含明暗任务卡片、环境/模型进度、暂停状态、资源列表、工作流目录/画布、插件，以及 520px 窗口倍速选择与焦点归还。任务/下载状态使用本地界面测试数据，未执行真实下载或重新转译；未重新打包安装客户端。
