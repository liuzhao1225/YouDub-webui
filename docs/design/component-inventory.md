# YouDub组件源码索引

2026-10-23 · 按实际组件导出盘点。平台适配与业务组件分别保留职责；具体契约见[视觉与组件规范](harness-visual-spec.md)。

| 源文件 | 导出组件/入口 |
| --- | --- |
| [apps/web/src/components/app-updates.tsx](../../apps/web/src/components/app-updates.tsx) | UpdateNotice, UpdateSettings |
| [apps/web/src/components/brand/brand-mark.tsx](../../apps/web/src/components/brand/brand-mark.tsx) | BrandMark |
| [apps/web/src/components/inline-alert.tsx](../../apps/web/src/components/inline-alert.tsx) | InlineAlert |
| [apps/web/src/components/language-switcher.tsx](../../apps/web/src/components/language-switcher.tsx) | LanguageSwitcher |
| [apps/web/src/components/localize-task-config.tsx](../../apps/web/src/components/localize-task-config.tsx) | TaskOptions, TaskConfigForm |
| [apps/web/src/components/models-settings/CustomProviderCard.tsx](../../apps/web/src/components/models-settings/CustomProviderCard.tsx) | CustomProviderCard |
| [apps/web/src/components/models-settings/DeepSeekModelsEditor.tsx](../../apps/web/src/components/models-settings/DeepSeekModelsEditor.tsx) | parseCapacity, formatCapacity, modelDrafts, validateDeepSeekModels, DeepSeekModelsEditor |
| [apps/web/src/components/models-settings/EditorFooter.tsx](../../apps/web/src/components/models-settings/EditorFooter.tsx) | EditorFooter |
| [apps/web/src/components/models-settings/ModelListEditor.tsx](../../apps/web/src/components/models-settings/ModelListEditor.tsx) | ModelListEditor |
| [apps/web/src/components/models-settings/ModelsSection.tsx](../../apps/web/src/components/models-settings/ModelsSection.tsx) | needsSetup, providerTargetLabel, providerCopy, ModelsSection |
| [apps/web/src/components/models-settings/ProviderEditor.tsx](../../apps/web/src/components/models-settings/ProviderEditor.tsx) | pathOps, ProviderEditor |
| [apps/web/src/components/models-settings/index.tsx](../../apps/web/src/components/models-settings/index.tsx) | ModelsSettings |
| [apps/web/src/components/page-layout.tsx](../../apps/web/src/components/page-layout.tsx) | PageContainer, Page, PageHeader, PageTitle |
| [apps/web/src/components/resource-row.tsx](../../apps/web/src/components/resource-row.tsx) | ResourceRow |
| [apps/web/src/components/section-card.tsx](../../apps/web/src/components/section-card.tsx) | SectionCard |
| [apps/web/src/components/settings-resources.tsx](../../apps/web/src/components/settings-resources.tsx) | SettingsResources |
| [apps/web/src/components/setup-diagnostics.tsx](../../apps/web/src/components/setup-diagnostics.tsx) | SetupDiagnostics |
| [apps/web/src/components/setup-gate.tsx](../../apps/web/src/components/setup-gate.tsx) | SetupGate |
| [apps/web/src/components/setup-installation.tsx](../../apps/web/src/components/setup-installation.tsx) | SetupInstallation |
| [apps/web/src/components/setup-resources.tsx](../../apps/web/src/components/setup-resources.tsx) | sizeLabel, EnvironmentSteps, ModelDownloadRow |
| [apps/web/src/components/setup-screen.tsx](../../apps/web/src/components/setup-screen.tsx) | SetupScreen |
| [apps/web/src/components/sidebar-link.tsx](../../apps/web/src/components/sidebar-link.tsx) | SidebarLink |
| [apps/web/src/components/task-cover.tsx](../../apps/web/src/components/task-cover.tsx) | TaskCover |
| [apps/web/src/components/theme-toggle.tsx](../../apps/web/src/components/theme-toggle.tsx) | ThemeToggle |
| [apps/web/src/components/translation-setup-view.tsx](../../apps/web/src/components/translation-setup-view.tsx) | TranslationSetupView |
| [apps/web/src/components/translation-setup.tsx](../../apps/web/src/components/translation-setup.tsx) | TranslationSetup |
| [apps/web/src/components/models-settings/primitives.tsx](../../apps/web/src/components/models-settings/primitives.tsx) | 直接复用 Harness Modal；仅保留删除后的焦点目标适配 |
| [apps/web/src/components/ui/disclosure.tsx](../../apps/web/src/components/ui/disclosure.tsx) | Disclosure |
| [apps/web/src/components/ui/input.tsx](../../apps/web/src/components/ui/input.tsx) | Input |
| [apps/web/src/components/ui/native-select.tsx](../../apps/web/src/components/ui/native-select.tsx) | NativeSelect, Choice |
| [apps/web/src/components/ui/progress.tsx](../../apps/web/src/components/ui/progress.tsx) | Progress |
| [apps/web/src/components/ui/segmented.tsx](../../apps/web/src/components/ui/segmented.tsx) | Segmented |
| [apps/web/src/components/ui/surface.tsx](../../apps/web/src/components/ui/surface.tsx) | Surface |
| [apps/web/src/components/ui/switch.tsx](../../apps/web/src/components/ui/switch.tsx) | Switch |
| [apps/web/src/components/ui/textarea.tsx](../../apps/web/src/components/ui/textarea.tsx) | Textarea |
| [apps/web/src/components/video-player.tsx](../../apps/web/src/components/video-player.tsx) | VideoPlayer |
| [apps/web/src/plugin/builtin/library.tsx](../../apps/web/src/plugin/builtin/library.tsx) | Library, TaskDetail, name, inject, apply |
| [apps/web/src/plugin/builtin/localize-editor.tsx](../../apps/web/src/plugin/builtin/localize-editor.tsx) | LocalizeEditor, name, inject, apply |
| [apps/web/src/plugin/builtin/media-upload.tsx](../../apps/web/src/plugin/builtin/media-upload.tsx) | UploadSlot, LaunchCard |
| [apps/web/src/plugin/builtin/schema-form.tsx](../../apps/web/src/plugin/builtin/schema-form.tsx) | schemaProblems, defaultConfig, validateConfig, ConfigEditor, useEditorSupported |
| [apps/web/src/plugin/builtin/settings.tsx](../../apps/web/src/plugin/builtin/settings.tsx) | name, inject, apply |
| [apps/web/src/plugin/builtin/shell.tsx](../../apps/web/src/plugin/builtin/shell.tsx) | name, inject, apply |
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
| [apps/harness/src/frontend/alerts.tsx](../../apps/harness/src/frontend/alerts.tsx) | InlineAlert |
| [apps/harness/src/frontend/examples-page.tsx](../../apps/harness/src/frontend/examples-page.tsx) | ExamplesPage |
| [apps/harness/src/frontend/i18n.tsx](../../apps/harness/src/frontend/i18n.tsx) | LanguageProvider, useI18n, useText |
| [apps/harness/src/frontend/plugins.tsx](../../apps/harness/src/frontend/plugins.tsx) | applyPlugins |
| [apps/harness/src/frontend/resource-pages.tsx](../../apps/harness/src/frontend/resource-pages.tsx) | ResourcesPage |
| [apps/harness/src/frontend/runtime.tsx](../../apps/harness/src/frontend/runtime.tsx) | FeatureProvider, useFeatures, domainSlots, createFeatures |
| [apps/harness/src/frontend/sdk.tsx](../../apps/harness/src/frontend/sdk.tsx) | bindComponent, NavigationContext, Link |
| [apps/harness/src/frontend/studio-page.tsx](../../apps/harness/src/frontend/studio-page.tsx) | StudioPage |
| [apps/harness/src/frontend/task-pages.tsx](../../apps/harness/src/frontend/task-pages.tsx) | TasksPage, TaskPage, NodePage |
| [apps/harness/src/frontend/theme.tsx](../../apps/harness/src/frontend/theme.tsx) | ThemeProvider, useTheme, ThemeToggle |
| [apps/harness/src/frontend/translation-setup.tsx](../../apps/harness/src/frontend/translation-setup.tsx) | applyTranslationSetup, TranslationSetup |
| [apps/harness/src/frontend/video-player.tsx](../../apps/harness/src/frontend/video-player.tsx) | VideoPlayer |
| [apps/harness/src/frontend/workflow-pages.tsx](../../apps/harness/src/frontend/workflow-pages.tsx) | WorkflowsPage, WorkflowPage |

共享控件由 `apps/web/src/components/ui/` 提供业务属性适配；`harness-primitives.ts` 是框架依赖入口，桌面构建映射到当前 Harness 客户端加载器持有的官方模块。原 `apps/harness/src/frontend/controls.tsx`、`dialog.tsx`、`popover.tsx` 已移除。
