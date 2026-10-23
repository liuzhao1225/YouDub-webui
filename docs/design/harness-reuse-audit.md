# Harness 复用审计

日期：2026-10-23。活动产品为 `apps/harness`，框架权威源为 `vendor/deepseek-harness/source`；来源记录于 `vendor/deepseek-harness/upstream.json`，必要差异由 Git 维护。

## 已检查并清理的重复实现

| 区域 | 直接复用的 Harness 源码 | 清理与适配边界 |
| --- | --- | --- |
| 桌面更新 | `apps/desktop/src/update-schedule.ts`、`ui-settings-general/DesktopUpdateIndicator.tsx` | 复用自动检查调度、侧栏状态与折叠徽标；产品检查现有 GitHub 发布列表，并在用户确认后打开 DMG / EXE 下载。详见 [更新链路](../../apps/harness/docs/UPDATES.md)。 |
| 窗口分区、侧栏宽度和拖拽 | `ui-layout/src/client/AppFrame.tsx` / `.module.css` | 移除 icon rail、贯通全宽的自制顶栏及配套状态。展开侧栏贯穿全高，macOS 收起后宽度为零。AppFrame 源码恢复原实现。 |
| 侧栏与收起后入口 | `ui-sidebar/src/client/SidebarRoot.tsx`、`HeaderLeadingControls.tsx` | 保留原平台安全区、折叠动效、按钮布局；产品只提供导航、标签、品牌和底部工具。选中状态读取真实 layout panelInfo，不再制造路由版 hook。 |
| 页面窗口栏 | `ui-conversation/src/client/skeleton/ConversationRoot.module.css` | 删除固定 52px 的 yd-windowbar、重复窗口标题 CSS 和手工折叠偏移。直接引用 header/titleRow/titleCluster/crumbs/headerActions；业务 PageHeader 通过 portal 提交标题与操作。 |
| 深浅色与表面层次 | `ui-theme/src/styles/design-platform.css` | 删除旧全局近似配色；harness-palette.css 将业务语义映射到原生 token。背景、正文、边线、状态和阴影由 Harness 决定。用户明确要求保留红色主按钮，因此仅覆盖主按钮 fill #e6002e、hover #cc0029、foreground #fff 三项。 |
| 按钮、输入、开关、复选框、提示、标签、分段选择 | `ui-primitives/src/{Button,Input,Switch,Checkbox,Tooltip,Tag,SegmentedControl}.tsx` | 统一 harness-primitives 入口；桌面使用 ModuleLoader 的同一模块。删除额外 XL 高度和单独链接按钮皮肤；保留业务属性名称转换。 |
| 选择菜单、快捷参数浮层 | `ui-primitives/src/Menu.tsx` | 原组件负责 Portal、菜单布局和焦点；Select/NativeSelect 只把业务选项和字段回调转换成 Menu 的属性。 |
| 对话框 | `ui-primitives/src/Modal.tsx` | 移除 Base UI Dialog 和重复样式；删除后触发按钮不存在时，模型编辑器适配层提供返回焦点目标。 |
| 折叠信息行 | `ui-primitives/src/DisclosureRow.tsx` | 移除自制 details/summary 控件；保留业务受控状态和内容容器。 |
| 通用与模型设置 | `ui-settings`、`ui-settings-general`、`ui-settings-models` | 原服务、表单、凭据和离开保护。保留已验证的简化文案及未选提供商时不提前展示 Bedrock 警告的改进。 |
| 插件管理 | `ui-plugin-manager` Page/Controller/stores/Toast | 保留完整原页面，不再套自制标题栏。产品只筛选可展示包、接入内置功能事实与文案；帮助图标移入标题同行。 |
| 数据与导航状态 | `store`、`ui-layout`、`ui-slots` | 使用原 snapshot store、panelInfo 和插槽机制。业务路由主面板共用同一业务 store，领域插槽由原生 registerFactory 声明一次，各面板通过 renderFactorySlot 使用。 |

## 保留的业务实现及具体原因

- YouDub 图形、字标和声波：产品品牌。图形光学中心以矩形与声波中线计算，包含尾尖的完整 viewBox；侧栏品牌行使用 16px 上下留白。原 SidebarRoot 的固定 24px 品牌盒需改为 min-height，避免裁切。
- 品牌渐变：用户明确要求保留；以 Harness bg-base 为底色，粉蓝透明叠层自然淡出。不得改写主窗口基础黑白色。
- 上传、资源准备、任务列表、人工确认、字幕编辑、工作流画布及媒体播放器：YouDub 业务页面和状态。Harness 没有对应的配音工作流、字幕编辑与双音轨播放器。
- Page 内容容器：用于共享业务页面的阅读宽度与画布例外；窗口外壳交给 AppFrame。普通内容尺寸遵循原 PluginManagerPage 的 960px 宽度与 clamp 页面边距。
- Surface：简单的业务内容容器，使用原生表面/边线 token；当前 primitives 未提供通用 Card。
- Progress：模型下载与任务完成比例，支持未知总量、暂停和完成；当前 primitives 未提供通用进度条。使用原生状态 token，删除品牌渐变填充。
- Textarea：原生受控 textarea，直接引用 Harness InlineEditor 的外观；业务表单需多行受控输入和手动调整高度。
- 示例 iframe：承载既有示例资源与同步播放器，通过共享 token 接入主题。
- TextShimmer 的 inert：共享组件分别运行于 React 18 Desktop 和 React 19 Web；通过 DOM attribute 保留原有 inert 行为，解决两套 React 类型差异，不改变视觉。

## 验证与边界

- 原始 AppFrame/SidebarRoot 行为及主题来源已核对；安装版 app.asar 的 theme/layout bundle 与活动源码对照已保留。
- 原生 dark 标题栏像素 `[21,21,23]`，侧栏中部 `[49,49,51]`，与对照截图采样一致；原生 light 主背景 `[255,255,255]`。半透明侧栏受系统背景影响，不以单张截图全像素相等作为验收标准。
- 先前框架全量 GUI：446 文件、7443 测试通过。最新共享控件针对性测试：4 文件、19 测试通过；TextShimmer：1 文件、2 测试通过；Web 类型检查通过。
- 本次首次原生启动暴露重复 children 插槽声明导致插件激活失败；单面板声明的中间版本又使其他面板缺少插槽权限。最终使用 Harness registerFactory 声明共享业务工厂，各主面板通过 renderFactorySlot 渲染。重启后任务库、工作流、资源和原生插件页均已打开并读回，侧栏展开、完全收起及再次展开已验证。
- 主按钮恢复品牌红，原生浅/深色“确认并继续”均显示红底白字；证据 native-reuse-red-action-light.png、native-reuse-red-action-dark.png。窗口栏操作采用原生 sm 尺寸，避免默认 md 控件撑高标题行。
- 对照原始主页源码和 fusion-reference-home.png 后，工作台 Logo 改为按可见主体与标题字高匹配，并补偿光学留白。原生浅色、深色和收起侧栏截图确认尾尖完整、声波可见、内容居中；证据 native-reuse-hero-large-light.png、native-reuse-hero-large-dark.png、native-reuse-hero-large-collapsed.png。
- 此表覆盖外壳、通用控件与样式归属。最终本地原生页面、工作流产物、错误恢复及 7445 项 GUI 检查见 [全产品验收](impeccable-ui-review.md)；本轮没有发布。
