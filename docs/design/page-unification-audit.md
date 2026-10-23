# Harness × YouDub 逐页统一验收

2026-10-22。按 [页面清单](page-map.md) 与 [视觉规范](harness-visual-spec.md) 检查。工作目录为 `harness-youdub-integration/YouDub-webui`；实际应用入口 `http://127.0.0.1:51591/`。

## 共同标准与本次修正

- `Page` / `PageContainer` 统一普通页面顶部28px、横向`clamp(24px,4vw,48px)`、内容最大960px；页面主要内容块间32px。
- `PageHeader` / `PageTitle` 统一标题20/28px、字重500，与 Harness PluginManagerPage 一致。任务步骤返回入口并入标题行。资源页补齐页头。
- 保留工作台品牌区、全宽画布、首次准备窄表单、Harness 原生设置与扩展详情的结构差异。画布工具栏顶部仍为28px；窄屏操作按钮整组换行。
- 首页与运行面板移除输入框高度覆盖；快捷选择器不再另设背景、字号；节点操作使用共享 Button。
- 输出卡片、步骤配置、分段配音、首次准备统一使用 Surface；列表结构语义保持 dl/ol。
- 修正独立 Web 的 CSS layer 加载次序，确保页面内距不被 preflight 重置；标题样式避开宿主元素重置。
- 示例页接入共同页头，隐藏网站版重复页头。隔离 iframe 内按钮与分段选择器复用 Harness 原始 CSS，保留原播放器行为；修正浅色播放图标和 iframe 高度取整产生的内部滚动条。
- 窄屏“版本”标签不换行。YouDub Logo、品牌标题、粉蓝渐变与主操作色继续保留。

## 页面覆盖

“实际”表示打开当前应用并检查；“组件预览”表示渲染真实业务组件并注入固定数据，不代表执行了安装、模型推理或任务提交。

| 页面 / 界面 | 共同组件与结果 | 验证 |
| --- | --- | --- |
| 工作台 `/` | PageContainer、Input、Select、Button、资源状态；输入与上传对齐、聚焦无外圈 | 实际，浅/深色、375px；[截图](../../output/validation/page-audit-20261022/01-home.png) |
| 任务库 `/tasks` | Page、PageHeader、Tag、任务卡片 | 实际，标题x328/y28/20px（1280视口），375px无横向溢出；[截图](../../output/validation/page-audit-20261022/02-tasks.png) |
| 任务详情 `/tasks/:id` | Page、PageTitle、Surface、共用播放器/工作流/日志 | 实际 zoo 任务；[截图](../../output/validation/page-audit-20261022/08-task-detail.png) |
| 步骤详情 `/tasks/:id/nodes/:nodeId` | PageHeader、Segmented、Input、Textarea、Surface、Disclosure | 实际语音识别，结果/输入/配置/日志逐项切换；[截图](../../output/validation/page-audit-20261022/09-transcription.png) |
| 翻译 / 配音及其他结果类型 | 共同步骤页外壳，业务编辑器保留；版本标签和表面统一 | 组件预览：翻译、生成配音、准备媒体、分离人声、参考音频、混音、字幕对齐、导出；桌面及翻译/配音窄屏；[翻译](../../output/validation/page-audit-20261022/26-translation-fixture.png) |
| 工作流列表 `/workflows` | Page、PageHeader、Surface、Button | 实际，标题x328/y28/20px；[截图](../../output/validation/page-audit-20261022/03-workflows.png) |
| 新建 `/workflows/new` | 共同编辑器外壳、Input、Button、节点选择面板 | 实际空草稿与节点列表；未保存草稿；[截图](../../output/validation/page-audit-20261022/15-new-workflow.png) |
| 编辑 `/workflows/:id` | 共同画布页头、Node、表单控件 | 实际字幕翻译模板，顶部28px，375px操作整组换行；[截图](../../output/validation/page-audit-20261022/13-workflow-editor.png) |
| 节点配置 `/workflows/:id/nodes/:nodeId` | Page、Surface、SchemaForm、Input、Select、Choice | 实际语音识别完整设置；[截图](../../output/validation/page-audit-20261022/14-node-settings.png) |
| 工作流运行面板 | 与主页共用输入/上传/资源组件 | 实际打开运行面板，375px检查；未启动新任务；[截图](../../output/validation/page-audit-20261022/31-run-panel-mobile.png) |
| 资源 `/resources` | PageHeader、SettingsResources、ResourceRow、Surface、Progress、Disclosure | 实际加载资源与状态；标题x328/y28/20px；[截图](../../output/validation/page-audit-20261022/04-resources.png) |
| 示例 `/examples` | Page、PageHeader；iframe消费原始Harness Button/Segmented CSS | 实际切换原始英文/中文配音；iframe clientHeight=scrollHeight=738；[截图](../../output/validation/page-audit-20261022/16-examples.png) |
| 扩展 `/extensions` | Harness 原生 PluginManagerPage | 实际列表/包详情/添加弹窗；标题x328/y28/20px；[截图](../../output/validation/page-audit-20261022/05-extensions.png) |
| 设置：通用 / 模型 / 添加提供商 | Harness 原生设置和模型编辑器 | 实际打开各界面，取消提供商编辑；[截图](../../output/validation/page-audit-20261022/17-settings.png) |
| 首次安装 | PageContainer、PageTitle、Input、NativeSelect、Button | 真实SetupScreen组件预览；[截图](../../output/validation/page-audit-20261022/22-setup-installation.png) |
| 环境准备 / 模型准备 | ResourceRow、Surface、Progress、Button、SetupDiagnostics | 真实组件预览，下载/等待/校验状态；[环境](../../output/validation/page-audit-20261022/23-setup-environment.png)、[模型](../../output/validation/page-audit-20261022/24-setup-models.png) |
| 首次翻译服务配置 | TranslationSetupView、ModelsSettings、PageContainer | 真实组件预览，空提供商目录测试数据；[截图](../../output/validation/page-audit-20261022/25-setup-translation.png) |

## 验证与边界

- 9个测试文件共89项通过：工作流编辑、步骤校对、任务库、工作台、运行面板、资源、安装、模型设置、基础控件。
- 最后修改版本标签、列表表面和画布换行后，重跑受影响3文件33项通过；TypeScript `tsc --noEmit` 通过。
- Harness 客户端构建通过。最终构建重新核对当前框架源码与 source-build 收据，SHA-256 为 `485b4c3e4c175d93d2a65ea98e757ebc206e7ae90b4e4415eef381f4934c85a9`。中途因并行框架清理使旧收据不匹配而停止过构建，核对新收据后重新构建成功。
- 实际应用验收使用 Harness 浏览器承载入口。首次准备与若干节点结果使用隔离组件预览；本次没有执行真实下载、重新跑模型或打包冷启动验收。
- 当前隔离运行环境的历史任务缺少翻译节点插件；翻译编辑器的视觉验收通过组件预览完成。该插件运行状态不属于本次视觉修正。
- 保留同目录其他进行中的框架与资源逻辑改动，未全量提交或推送工作区。
