# Harness × YouDub 视觉与组件规范 v2

2026-10-22 · 以仓库内 vendored Harness 源码为准。规范覆盖 Web 与 Harness 桌面承载的全部 YouDub 组件。

## 1. 来源与职责

Harness 负责控件几何、字阶、布局关系、层级、材质、交互状态和键盘行为。YouDub 保留 Logo、红色主操作、粉蓝渐变、蓝色完成态、粉色运行态以及浅深主题的中性色体系。

实现优先级：直接复用 Harness 组件 → 复用原始 CSS 与轻量属性适配 → 用 Harness token 组合业务组件。组件内部样式不在页面重新定义。颜色在主题层映射，组件和页面只消费语义 token。

上游组件的局部尺寸是具体控件的规范，不应把所有控件强行设为同一种高度或圆角。下文精确值来自源码；内容区域宽度、字幕列布局和播放器比例属于 YouDub 业务规则。

## 2. 基础几何

| Token | 值 | 具体用途 |
| --- | --- | --- |
| `--dsw-radius-xs` | 4px | 小型内部结构 |
| `--dsw-radius-sm` | 8px | 紧凑按钮、多行编辑、Tooltip |
| `--dsw-radius-md` | 12px | 标准按钮、单行输入、菜单项、紧凑菜单 |
| `--dsw-radius-lg` | 16px | 菜单面、分段标签容器、Toast |
| `--dsw-radius-xl` | 20px | 大型业务内容容器 |
| `--dsw-radius-panel` | 28px | Modal |
| 胶囊 / 圆形 | 999px / 50% | Tag、Switch、进度条、状态点 |

圆角曲率使用 `superellipse(1.5)`，通过 `@supports` 渐进启用。胶囊和圆形显式 `corner-shape: round`。不以给所有元素套同一圆角代替组件复用。

边线以 0.5px 为控件基准；浮层描边由 elevation 的 0.5px shadow 绘制。避免 border 与 elevation 描边重复叠加。拖拽区域的虚线是 YouDub 业务可供性，保留浅色细线。

Harness 未发布统一 spacing token 枚举。已存在的组件间距直接使用上游值：按钮4px、输入6px、菜单6px、表单6px、弹窗操作8px、弹窗内容20px、弹窗侧边24px。YouDub 页面空间使用4/8/12/16/24/32px节奏；不能据此覆盖上游6px、20px等尺寸。

## 3. 字体与排版

系统无衬线采用 `--dsw-font-family`；代码采用 `--ds-font-family-code`。保留平台中文字体回退。控件字阶从组件原始 CSS 继承。

| 内容 | 字号 / 行高 | 字重 |
| --- | --- | --- |
| Button md / Input / Modal 正文 | 14 / 22px | 默认400 |
| Button sm | 12 / 18px | 默认400 |
| 多行编辑 / Tooltip / 菜单 | 13 / 20px | 默认400 |
| SegmentedControl | 13 / 20px | 500 |
| Tag | 11 / 17px | 500 |
| Modal 标题 | 16 / 24px | 500 |
| 折叠行 | 13 / 24px，跟随内容字号设置 | 默认400 |
| 页面标题（Harness PluginManagerPage） | 20 / 28px | 500 |
| 工作台品牌标题（YouDub品牌） | clamp(28px,4vw,48px) / 1.2 | 700 |

正文内容字号设置与固定控件字号分开；不把整个应用强制缩放。时间、字节、速度用等宽数字；代码和日志使用等宽字体。长字幕自然换行。状态文字与图标共同传达含义。

## 4. 层级与材质

- `bg-base`：页面；`bg-layer-1`：内容和输入；`bg-layer-2/3`：浮层、选中面；颜色由 YouDub 映射。
- `elevation-panel`：0.5px描边 + 0 3px 8px / 3% + 0 0 16px / 2%。
- `elevation-prominent`：0.5px描边 + 0 3px 8px / 4% + 0 0 20px / 5%，用于菜单、弹窗。
- `elevation-soft`：0.5px描边 + 0 4px 16px / 3% + 0 0 24px / 3%。
- 菜单背景 blur(40px) saturate(150%)；遮罩 blur none。菜单透明度沿用 Harness，颜色基底使用 YouDub。
- 菜单内联层级100，Modal1000，portal菜单/Tooltip1100。关闭后恢复焦点，嵌套菜单位于弹窗上方。
- 普通业务列表用表面和分隔线，不叠加浮层阴影。遮罩必须阻挡背景交互。

## 5. 动效与焦点

统一缓动 `cubic-bezier(0.4,0,0.2,1)`；基础100/200/300ms。组件特定动效沿用源码：Switch120ms、SegmentedControl160ms、Tooltip150ms、Modal200ms、StateDot1500ms。

鼠标点击与键盘焦点分开。Input 和 Textarea 聚焦仅改变现有边线颜色，outline none、无外部焦点阴影。开关、复选框、按钮等保留 Harness 的键盘焦点指示。禁止全局删除所有 focus-visible。

减少动态效果时停止位移和旋转，保留静态状态与文本。真实任务状态驱动进度；没有总量时不制造百分比。

**Logo 动效为必备品牌规范。** Web 与桌面端的侧栏 Logo（展开与收起）、工作台主 Logo、首次准备与翻译服务配置页的品牌 Logo，均必须使用共享 `BrandMark animated`。默认展示时持续播放，不能仅在 hover 或任务运行时启用；Harness 组件迁移、样式收敛和页面重构必须保留此要求。静态文档、导出资产和系统应用图标使用原始静态 Logo。

- 动效仅作用于左右粉色、蓝色声波条；中央红色播放气泡、白色播放符号和 YouDub 字标保持稳定，品牌原色及粉蓝渐变保持不变。
- 沿用既有 `animate-eq`：周期 1.1 秒、`ease-in-out`、无限循环；每根声波以自身中心沿 Y 轴缩放，起止为 0.38，中点为 1。错峰延迟读取 `BrandMark` 的既有定义，页面不另写一套关键帧或时序。
- 动效不改变 Logo 外框尺寸、留白、点击区域及布局，不添加整标跳动、旋转、闪烁或发光。声波表达品牌，不承担下载、播放或任务进度提示。
- 系统开启 `prefers-reduced-motion: reduce` 时展示完整静态 Logo；这是无障碍例外。普通动态模式下，静态替换或缺失动效均视为验收不通过。

来源：[BrandMark](../../apps/web/src/components/brand/brand-mark.tsx)、[声波关键帧与减少动态效果规则](../../apps/web/src/app/globals.css)。上述要求是统一后的验收标准，实际页面是否启用须逐一核对。

## 6. 基础组件契约

| 统一入口 | Harness 来源 | 几何和状态 | 使用边界 |
| --- | --- | --- | --- |
| Button / buttonVariants | Button | md36px /12px角；sm28px /8px角；水平14/10px；disabled40% | primary/outline/ghost/toolbar；布局可调整宽度，颜色仅语义变体 |
| Input | Input | 高32px，横8px，gap6px，12px角，0.5px边线 | URL/搜索/密码/数字共用；icon槽16px；禁用/无效状态保留 |
| Textarea | InlineEditor样式 | 最小28px，3px 8px内距，8px角，0.5px边线 | 保留显式保存、换行和表单语义；不引入聊天编辑器Enter提交行为 |
| NativeSelect / Select | 桌面Button+Menu，Web同源外观适配 | 触发器36px/12px角；菜单16px角 | 单选；当前项有勾选；关闭后焦点可回到触发器 |
| Choice | Checkbox | 原生16px复选框，标签gap6px，disabled50% | 受控布尔值；可见或可访问标签必填 |
| Switch | Switch | 36×20px，thumb16px，padding2px，位移16px | 即时二选一；不是执行按钮；checked与aria-checked一致 |
| Segmented | SegmentedControl | 容器padding4px/12px角；项28px/8px角；总高36px | 互斥面板；方向键/Home/End；选中项唯一tab stop；关联panel |
| Tag | Tag | 1px 8px，11/17px，胶囊 | 只读标签；outline/solid/neutral/quiet/success/info/warning/danger |
| Tooltip | Tooltip | 3px 7px，8px角，最大50vw，gap8px | 提供短提示；纯图标仍需aria-label；不承载必要错误 |
| Dialog / Modal | Modal | 默认宽380px，28px角，内容侧距24px | 宽业务编辑器可调整尺寸；复用遮罩、焦点管理和关闭逻辑 |
| Menu / Popover | Menu+MenuSurface | padding4px，item最小34px、6px 8px内距；菜单144–360px | viewport边距12px，避免被弹窗裁剪；自定义内容不伪装菜单项 |
| Disclosure | DisclosureRow样式 | 行24px、leading16px、gap6px、13px字 | 展开日志、原始数据、步骤；原生details语义，状态保持由调用方决定 |
| InlineAlert | StateDot语义 + 组合表面 | 12px内距，gap8px，12px角 | danger用alert；info/warning用status；错误原因可见 |
| Progress | YouDub组合 | 6px轨道，胶囊；完成蓝、运行粉蓝、暂停中性 | 所有安装/下载/任务进度共用；value为0–1，未知则省略aria-valuenow |
| Surface / SectionCard | Harness表面token + 组合 | 16px角，0.5px分隔；内容内距16px | 单一容器，不在行内嵌套同类装饰卡片 |

桌面使用 Harness 官方组件，Web 优先直接引用 vendored 无运行时依赖组件；需要保留Web表单和浮层语义的适配器引用同源CSS。兼容层仅转换属性、事件和挂载机制，不定义另一套颜色/圆角。

## 7. 组合组件与页面清单

| 类别 | 既有/统一组件 | 组成与专属职责 |
| --- | --- | --- |
| 外壳 | Shell、SidebarLink、ThemeToggle、LanguageSwitcher | Harness框架/按钮/菜单；YouDub Logo和导航渐变标记 |
| 页面 | Page、PageContainer、PageHeader、PageTitle | 共同内容边界；画布保留全宽；标题与操作对齐 |
| 工作台 | Studio、LaunchCard、MediaUpload、WorkflowRun、WorkflowOptions | 同宽输入与上传；共享Input/Button/Select；只保留一个内容主操作 |
| 任务库 | Library、TaskCover、StatusBadge、TaskProgress | 同一Tag/Progress；缩略图、标题、元信息、动作层级 |
| 任务详情 | TaskDetail、ResultViewer、TaskLog | 文件输出、播放器、折叠日志和错误；不重画按钮和卡片 |
| 校对 | TranscriptEditor、TranslationEditor、SpeechEditor | Input时间字段、Textarea文本、共享搜索；原文译文等宽、顶对齐 |
| 工作流 | WorkflowCanvas、Node、WorkflowSettings、SchemaForm | 节点是专属业务容器；字段使用共享组件；线/端口保留图语义 |
| 设置 | Settings、ModelsSection、ProviderEditor、ModelListEditor | Harness设置结构；共享输入/选择/开关/弹窗；凭据仅掩码字段 |
| 首次准备 | SetupScreen、SetupInstallation、TranslationSetupView | 共享表单与表面；保留明确安装/测试跳过入口 |
| 资源 | SettingsResources、ResourceRow、EnvironmentSteps、ModelDownloadRow | 状态来源不变；准备、下载、校验共用Tag/Progress/Button |
| 诊断 | SetupDiagnostics、WorkflowErrors、InlineAlert、Disclosure | 可展开细节；失败原因与恢复动作可见 |
| 更新 | AppUpdates | 共用状态/动作/表面；不产生独立颜色 |
| 媒体 | VideoPlayer、音频结果 | YouDub专属比例/字幕/进度；Tabler原版播放暂停图标 |
| 品牌 | BrandMark、示例入口 | 保留SVG、品牌色、粉蓝渐变；品牌入口必须启用共享声波动效，遵循第5节 |

组件盘点表见 [组件源码索引](component-inventory.md)。业务组件单独拥有业务布局；只有重复的视觉/交互结构进入共享组件，避免为每个静态标签创建新抽象。

## 8. YouDub 颜色映射

品牌原色：红 `#FF0033`、粉 `#FB7299`、蓝 `#00AEEC`；主操作 `#E6002E`，hover `#CC0029`。品牌渐变保持粉→蓝。

| Harness语义 | YouDub token | 浅色 / 深色 |
| --- | --- | --- |
| brand-primary、button-primary-fill | primary | #E6002E / #E6002E |
| button-primary-hover | primary-hover | #CC0029 / #CC0029 |
| bg-base | background | #F6F6F8 / #0A0A0E |
| bg-layer-1 | card | #FFFFFF / #121218 |
| bg-layer-2、bg-layer-3、bg-overlay | elevated | #FFFFFF / #18181F |
| label-primary | foreground | #0B0B0F / #EDEDF0 |
| label-secondary、tertiary、dimmed | muted-foreground | #5F5F6B / #A0A0AB |
| border-l1/l2/l3 | border | 黑8% / 白8% |
| border-l4 | input | #DEDEE3 / #383840 |
| state-business-primary | link | #00739F / #3CC4F5 |
| state-success-primary | status-success-fg | #00739F / #5FD0F5 |
| state-error-primary、label-error | status-danger-fg | #C8002A / #FF6B81 |
| state-warn-primary | status-warning-fg | #9A5B00 / #F7C26B |
| state-idle-primary | status-neutral-fg | #52525B / #B4B4BD |
| 运行态业务语义 | status-running-fg | #C2185B / #FF9AB8 |

同一映射同时供Web CSS与Harness构建读取，禁止在两个入口维护不同映射。颜色值集中在globals.css。Tag沿用Harness10%着色（warning12%），不另外硬编码背景色。

## 9. 状态与交互验收矩阵

| 场景 | 必须验证 |
| --- | --- |
| 文本输入 | 默认、hover、focus、内容、disabled、readonly、invalid；无外圈；placeholder可读 |
| 按钮 | 正常、hover、active、keyboard focus、disabled；忙碌由实际状态驱动 |
| 选择 | 当前值、选中勾选、键盘移动、Escape关闭、焦点返回、长选项、禁用选项 |
| 弹窗 | 遮罩、焦点进入/限制/返回、Escape、关闭按钮、长内容滚动、窄屏边距 |
| 折叠 | 鼠标与键盘切换；标题可读；展开后内容不溢出；日志更新不强制滚动用户正在读的内容 |
| 任务进度 | 0、处理中、1、暂停、未知总量；从真实值派生，错误原样可见 |
| 主题 | light/dark/system；默认light；Logo/渐变/主操作保持YouDub颜色 |
| Logo 动效 | Web/原生桌面、侧栏展开/收起、工作台、首次准备与翻译配置；默认持续错峰声波，无布局抖动；浅深色一致；减少动态效果时静态展示 |
| 响应式 | 桌面、窄容器、375px；字段同宽、操作换行、菜单不裁剪 |
| 媒体 | 播放/暂停、进度、倍速、音量、全屏；图标与真实播放状态一致 |

## 10. 开发约束

- 新页面从共享入口导入控件，不引入新的UI库。
- Logo 动效属于必须保留的 YouDub 品牌语言；相关入口统一使用 `BrandMark animated`，不得在 Harness 适配中删除或静态替换。
- className允许宽度、布局、容器定位；需要控件新尺寸或状态时修改共享组件契约。
- 不在Input/Select/Button调用点写rounded、border、shadow、ring、背景色与固定控件高度。
- 禁止用`fill-current`填充线框播放图标；使用Tabler原版实心字形。
- 无现成上游组件时明确标注“YouDub组合”，不把业务自定尺寸声称为Harness标准。
- 上游更新后以源码为准复核规范和可交互展示；规范页不作为业务功能完成证据。

## 11. 源码依据

- [Button](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Button.module.css)
- [Input](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Input.module.css)
- [InlineEditor](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/InlineEditor.module.css)
- [Switch](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Switch.module.css)
- [Checkbox](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Checkbox.module.css)
- [SegmentedTabs](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/SegmentedTabs.module.css)
- [SegmentedControl](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/SegmentedControl.module.css)
- [Tag](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Tag.module.css)
- [Menu](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Menu.module.css)
- [MenuSurface](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/MenuSurface.module.css)
- [Modal](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Modal.module.css)
- [Tooltip](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Tooltip.module.css)
- [DisclosureRow](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/DisclosureRow.module.css)
- [StateDot](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/StateDot.module.css)
- [Toast](../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Toast.module.css)
- [base](../../vendor/deepseek-harness/source/packages/client/ui-theme/src/styles/base.css)
- [corner-shape](../../vendor/deepseek-harness/source/packages/client/ui-theme/src/styles/corner-shape.css)
- [gradient-shadow-text](../../vendor/deepseek-harness/source/packages/client/ui-theme/src/styles/gradient-shadow-text.css)
- [focus](../../vendor/deepseek-harness/source/packages/client/ui-theme/src/styles/focus.css)
- [design-platform](../../vendor/deepseek-harness/source/packages/client/ui-theme/src/styles/design-platform.css)
- [scrollbar](../../vendor/deepseek-harness/source/packages/client/ui-theme/src/styles/scrollbar.css)

[YouDub主题](../../apps/web/src/app/globals.css) · [桌面控件适配](../../apps/harness/src/frontend/controls.tsx) · [视觉速查页](ui-design-reference.html)

## 10. 页面内容边界

普通页面直接复用 `Page`、`PageHeader` 和 `PageTitle`。来源为 Harness `PluginManagerPage`：顶部内距28px，横向内距`clamp(24px, 4vw, 48px)`，内容最大宽960px。主内容块之间32px；标题与操作区同属一个可换行页头。返回入口置于标题行，避免独立返回行额外推低内容。

详情与编辑页复用同一页头结构：返回按钮、标题、状态标签、右侧操作。次要日期置于标题下方；工作流名称默认展示为标题，点击编辑按钮才进入输入状态。页头空白区域声明 `data-window-drag`，交互控件沿用 Harness 的 `no-drag` 规则，画布保持自身拖动行为。

工作台沿用同一内容宽度与横向内距，保留品牌标题区域。工作流画布保留全宽、填满工作区，页头顶部仍为28px；节点设置用普通页面边界。首次准备保留品牌页头与较窄的表单容器，品牌页头上边距28px。设置和扩展详情保留 Harness 原生结构。

工作流输入、输出各自拥有独立配置面板；选择输入节点仅显示输入字段，选择输出节点仅显示输出映射。使用同一层级的面板标题和共享表单控件，取消“输入 / 输出”合并分组及嵌套边框。节点点击、双击和“完整设置”均指向对应配置。

页面只设置宽度、内容排列和业务比例；输入、按钮、表面、分段选项等由共享组件提供圆角、边线和状态。除明确记录的品牌/画布/首次准备结构外，禁止页面另设`py-4`、重复页头或局部大号输入框。
