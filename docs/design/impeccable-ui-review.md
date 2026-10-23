# 全产品 UI 优化与验收

2026-10-23 · 工作分支 `codex/harness-youdub-integration`。范围依据[页面清单](page-map.md)，设计依据[YouDub UI 规范](ui-design-system.md)与[Harness 组件规范](harness-visual-spec.md)。

## 本轮环境

- 原生验收应用：`YouDub UI Review.app`，独立 home、profile、用户数据和 runtime，位于 `.cache/harness/impeccable-20261023/`。
- 初始工作区：`8458f2f8`；开始时仅有未跟踪的 `output/`，保留已有产物。
- 初次启动使用 `YOUDUB_TEST_SKIP_SETUP=1`，只用于页面检查，不证明环境、模型或首次引导完成。
- 原有 `YouDub Review Validation` 客户端及正在运行的配音任务保持运行。
- 本轮截图及检查输出：`output/validation/impeccable-20261023/`。

## 最终结果

本轮代码、设计文档和本地 Electron 验收已完成。客户端恢复为中文、跟随系统、展开侧栏与常用窗口；未保存草稿为空，保留五条真实媒体验收任务。没有执行发布。

- 外壳、完全收起侧栏、窗口栏、深浅色和基础控件直接复用 Harness；保留品牌红按钮、粉蓝渐变、Logo 光学中心和声波。归属及保留理由见 [Harness 复用审计](harness-reuse-audit.md)。
- env 翻译配置已生效；真实样例完成识别、翻译、订正派生和视频/字幕导出。已有本地配音任务完成并播放、下载校验。
- 最新框架构建 7 个门禁通过；GUI 完整运行加失败项复跑去重为 7445 项通过。业务组件完整回归 281 项通过，后续改动的针对性测试、类型检查和产品构建均有下方日志。最终源码检测为 `[]`，只代表该检测器没有返回发现。
- 代表性最终截图：`final-home-system-light.png`、`native-reuse-hero-large-narrow-dark.png`、`translation-corrected-video-frame.png`、`generic-result-light-narrow.png`。

## 页面覆盖

本表为最终状态。下方按执行顺序保留历史观察与失败记录，其中“当时待验证”“锁定”“未配置”等由本表及最后追加记录更新。覆盖各页面的适用主要状态，并组合检查明暗、跟随系统、宽窄窗口、中英日文和键盘行为；不将组合穷举或全部模型能力测试纳入 UI 验收结论。

| 范围 | 本轮证据与结果 | 状态 |
| --- | --- | --- |
| 外壳、导航、主题、语言 | 1280×820 与约 857×679 窗口、侧栏展开/完全收起/恢复；系统浅→深→浅实时跟随且草稿保留；真实减少动态效果开关及连续截图；语言菜单键盘选择与焦点返回 | 完成 |
| P01 工作台 | 明暗宽窄布局、语言参数、缺项与准备状态、禁用/可提交；已真实提交识别、翻译及配音任务；env 配置后缺少翻译服务提示消失；最终 `final-home-native.txt` | 完成 |
| P02 任务库 | 空态、筛选、长文件名、多语言、封面、终态；22 条独立夹具验证 20+5 分页及末页清空后返回。`library-empty-last-page-fixed-native.txt`、`library-ui-fixture-cleanup.json` | 完成 |
| P03 任务详情 | 实际媒体播放、暂停、定位、下载摘要一致；6/6 配音完成。故障插件任务实际失败后由原生“从头重试”完成第二次执行，输出内容读回；`task-retry-readback.json` | 完成 |
| P04 步骤详情与各结果 | 识别订正版本 2 保存/读回/确认，原始版本只读；真实翻译完成后订正派生、烧录字幕读回；配音各段播放、配置和日志；通用结果及原始数据 `generic-result-native.txt` | 完成 |
| P05 工作流库 | 内置、自定义、插件列表；有效导入、无效格式及原始诊断；保存副本、保留确认、实际删除本轮副本并读回 `workflow-delete-own-copy-native.txt` | 完成 |
| P06 新建工作流 | 独立工作流添加节点、保存、重启读回、运行；`workflow-saved-readback.txt` | 完成 |
| P07 工作流编辑器 | 输入/输出、拖拽连线、节点快捷参数、校验、撤销/重做、未保存保护、运行面板、真实运行；明暗宽窄窗口和面板焦点返回 | 完成 |
| P08 节点完整设置 | 配置、来源、自动下一步、未保存保护及滚动操作；不支持字段实际显示“以下字段需要插件编辑器：rows”，`node-unsupported-schema-light-narrow.png` | 完成 |
| P09 资源 | 环境与四模型实际准备并校验，重新检测可用；暂停/继续；独立故障配置的失败、重试、长原因摘要、可聚焦完整日志；`resource-error-details-keyboard.txt` | 完成 |
| P10 内置示例 | 明暗窄窗口、加载态、实际播放/暂停/定位、音轨/语言切换、全屏与 Esc；浅色轨道及全屏控件修复；首启入口返回准备 | 完成 |
| P11 插件 | 内置/包详情、长路径、安装帮助、焦点返回；原生安装本地仓库夹具、启用、交互、停用、卸载；无效目录保留输入并显示原因，`plugin-local-uninstalled.txt` | 完成 |
| 设置 | 中英日、主题、未选服务商、预设/自定义切换、草稿与离开保护；env 已检测，真实模型目录；取消/Esc 恢复到获取模型按钮，`model-discovery-escape-focus.txt` | 完成 |
| O01 安装设置 | 全新独立 home 正常启动，语言和目录提交；原生选择器回填/取消焦点、相对路径和根目录拒绝且保留草稿；`setup-directory-picker-selected-focus.txt` | 完成 |
| O02 环境与模型准备 | 正常环境及 4 模型共 6.97 GB 准备、校验、暂停/恢复和重启续传；独立受控失败、依赖等待、诊断及重试 | 完成 |
| O03 翻译服务配置 | 正常准备后进入；继续/稍后配置的草稿保护；用户授权 env 配置后检测可用，重启直接工作台并真实调用模型 | 完成 |
| 未匹配路由 | 明暗窄窗口本地化标题与返回工作台；`missing-route-{dark,light}-narrow.png`、`missing-route-return.txt` | 完成 |

## 验收边界与保留限制

- 当前受支持产品为 Electron；独立移动入口不存在，浏览器用于同一 Host 的开发调试。四个模型的资源可用与本轮执行过的识别/配音流程分别记录；未将资源就绪称为全部模型推理验收。
- 产品构建保留两条既有 CSS side-effect 警告，实际 CSS 由 build.mjs 显式装配。裁剪后的框架没有 `test:web` 脚本；框架构建的 Web build 门禁与 GUI 测试已执行。
- 开发时在运行中的客户端替换整包后 Cmd+R 曾出现模块导入失败，原因未定位；本轮候选以完整退出、重启后原生读回为准。正常页面导航和候选启动未复现该错误。
- externally-managed-environment 为独立故障 profile 的真实安装拒绝；保留原文，未绕过系统保护。正常 first-run 环境与五条真实验收任务保持可用。

## 规范修订与验证

以下为过程记录，保留原始失败与当时的验证范围；最终状态见上表。

- 未知下载总量：单资源及总体进度保持不确定态，不显示 `/ 0 B` 或伪造百分比。相关 setup/resources 测试 21 项通过；运行中的下载状态仍待原生验证。
- 规范统一：修正页面标题、宽度和间距的文档冲突；删除已不存在的控件适配文件索引。保持 Harness 控件几何与 YouDub 品牌。
- `library`、`setup-gate`、`settings-resources`：合计 28 项通过，包括空末页返回行为。
- `workflow-run`、`studio`、`graph-studio-draft`：40 项通过；语言选项测试初次因旧文案断言出现 4 个失败，已更新为明确语言标签，单独复跑 9 项全部通过。
- 内置媒体契约与工作流本地化：2 项通过。Web 类型检查通过；当前插件构建通过，画布 CSS 的两条 esbuild 警告来源已核对为 build.mjs 的显式 CSS 装配。
- 原生实例更新时重复复制既有依赖软链接失败，已停止该路径并改用复用现有桌面壳、更新插件的独立启动脚本。当前客户端已观察到新语言标签及新布局。

## 早期待办及后续去向

示例布局、结果订正、真实翻译/配音、首启与主题/窗口验收已在后续记录完成，最终证据汇总于页面覆盖表。

已保存的验收工作流 ID 为 `a322d67e-0cc9-4a73-ba7d-666f8b560699`，仅位于独立验收 home；初始仅用于保存读回，本轮已补齐输入、连线和输出并完成一次实际媒体准备任务，见下方记录。


## 示例页追加实查

- `html` 禁用内部滚动，`body` 用 flow-root 包含子内容边界；现有 ResizeObserver 继续按内容高度调整 iframe。宽/窄窗口切换与侧栏展开后，外层滚动可访问控制条和来源链接。
- 发现浅色背景上的轨道和滑块使用固定白色；共享 `site/style.css` 改用主题 muted / foreground，播放器全屏明确采用深色文字变量。证据：`examples-light-controls-fixed.png`、`examples-fullscreen-controls-fixed.png`。
- 运行中的插件文件更新后 Cmd+R 曾出现 `@youdub/harness-subtitles: import failed`；完整退出并加载同一构建后正常启动。只确认独立验证运行时的整包重启路径正常，热替换失败原因尚未证实，不将重启视作该问题修复。
- 失败报告同时包含旧示例页面的 ResizeObserver 循环警告；本次尺寸关系修复后的可见滚动已通过，控制台警告回归仍待确认。

## 模型、播放器和资源摘要追加验收

- 模型表单仅在用户明确选择服务商后显示；刷新不自动选择，既有草稿在模式切换、服务商目录变化和取消确认中保留。等待目录时展示真实加载状态。相关模型测试 356 项通过。
- 框架 GUI 首轮 7423 项通过，另 4 个文件在导入阶段因缺少 `DSH_TEST_PRODUCT_BUNDLE` 未运行；指定独立产品 bundle 后，这 4 个文件与模型包复跑共 376 项通过，去重为 7443 项。证据 `framework-gui-tests.log`、`framework-gui-rerun.log`。首次模型复跑曾因断言匹配隐藏表单失败，已限定到可见表单并通过。
- 工作流资源混合缺项与配置单独缺项测试通过；`workflow-run` 和 `studio` 共 38 项通过。Web 类型检查和插件构建通过。
- 构建过程曾发现日文加载文案缺失，以及 fork ledger 的文件大小未同步；均已修正并重新通过构建。未将这两次失败记为通过。
- vendored 客户端规则提及的 `test:web` 在当前裁剪后的框架 package.json 中不存在；本轮不宣称通过该命令，原生逐页验收继续记录。

## 插件及任务结果追加验收

- 插件列表、详情与安装弹窗：`plugins-list-light-wide.png`、`plugins-detail-light-narrow.png`、`plugins-install-dark-narrow.png`。删除重复的安装说明句，保留包名/地址占位说明、按需帮助、来源风险与更新方式。
- 从菜单打开安装弹窗后，原先 Esc 将焦点落到页面；直接打开则正常。菜单选择安装时先将焦点交给仍存在的触发器，弹窗关闭可正确返回，证据 `plugins-menu-dialog-focus.txt`。增强现有菜单组件测试，最终框架 GUI 446 文件、7443 测试全部通过（`framework-gui-plugins-focus.log`）；构建 7 道检查通过。
- 新建独立任务副本 `626052e5-606e-4ca7-afec-3e2309a2dcb5`，显示名“验收副本 · zoo-en.mp4”。仅复制一条已完成任务及 19 个引用文件，未复制设置、凭据、登录信息；副本清空外部请求记录，来源与文件摘要见 `task-fixture.json`。此样本证明当前 UI 对既有结果的展示和交互，不能证明本轮新任务处理成功。
- 结果视频播放到 12 秒并暂停，进度条键盘操作定位到 9.4 秒；重启后再次播放并暂停于 10.2 秒。初始 AX 曾短暂含“无法播放媒体”，实际点击播放后消失，图像与时间均推进；未将该短暂 AX 文本直接当作持续播放故障。证据 `task-result-playback-dark.png`。
- 识别校对输入长测试草稿，离开时默认聚焦“继续编辑”，确认后草稿保留；主动放弃后恢复原文。证据 `transcript-unsaved-dark-narrow.png`。未触发重新生成。
- 执行图的已完成节点省略旧过程消息，缺少插件时使用任务已保存的节点名称，并按端口 ID 去重输出。缺失插件提示、状态和实际边保留。原生读回 `task-canvas-completed-readback.txt`，全图截图 `task-canvas-completed-dark.png`。
- 画布与任务详情测试 28 项、Web 类型检查、插件构建通过。首次新增测试误用了本地化标签结构并遗漏 progress，导致 1 项失败及类型错误；修正测试夹具后上述检查通过。
- 翻译节点因独立 profile 没有原任务的服务商配置而显示缺少插件；相关编辑与重新生成尚未验收。


## 工作流与正常首启追加验收

- 工作流配置面板关闭后焦点原先落到页面。添加节点、输入、输出和运行入口现在暴露展开状态及面板关联；关闭按钮或 Escape 关闭时回到对应入口，子菜单先处理 Escape，提交锁定仍保持。原生验证输入字段 Escape 和输出面板关闭按钮；四类入口的交互回归测试通过。证据 `workflow-panel-focus.txt`。
- 工作流常见结构校验错误通过共享诊断组件提供中、英、日操作指引；原始错误保留在诊断详情，未知错误保持原文。实际缺少输出、节点未连接输出的中文提示已看到；补齐输出后显示“校验通过”。修改前证据 `workflow-validation-before.png`。
- 测试工作流 `a322d67e-0cc9-4a73-ba7d-666f8b560699` 增加“待处理视频”输入，拖拽连接到准备媒体节点，并添加原始音频输出；保存后重启读回成功。
- 本轮真实创建任务 `a67d8316-ace4-4834-b19e-d56854a7dec3`，从隔离副本的输入视频重新提取音频；保持自动下一步关闭。任务进入人工确认，音频实际播放到 19.072 秒，确认后显示已完成、1/1 步及 3.2 MB 生成文件。该证据只覆盖媒体准备工作流，不证明翻译、识别或配音已重新执行。证据 `prepare-audio-review-dark.png`、`fresh-prepare-task-completed.txt`、`fresh-prepare-task-completed.png`。
- 待确认节点也会遗留“正在提取原始音频”。执行图现在对已完成与待确认均省略旧过程消息；任务记录和确认行为不变。实际重启后待确认消息已消失，并成功完成确认，证据 `task-awaiting-review-fixed.png`。
- 资源页 FFmpeg 实际下载，观察到 29% 和 86% 进度；准备完成及重新检测后均为可用。证据 `resources-preparing-dark-narrow.png`、`resources-ready-dark-narrow.png`、`resources-ready-readback.txt`。
- 本轮 3 个工作流测试文件共 52 项通过；类型检查、插件构建和 diff 检查通过。新增测试首次类型检查因误用了查询选项 `exact` 失败，移除无效选项后通过。插件构建仍有既有两条 CSS 装配警告。
- 正常首启使用 `.cache/harness/impeccable-20261023/first-run.mjs`、独立 `first-run/home` 和 `first-run/user-data`；`YOUDUB_TEST_SKIP_SETUP=0`，不传测试 Python。原有 UI 验收数据保留。截图 `first-run-install-light-wide.png`、`first-run-install-dark-ja-narrow.png`。正常 Python 下载与安装已观察，全部模型准备正在继续，不计为环境已就绪。
- 首启进一步发现：环境摘要直接展示安装文件全名及下载源，且等待用户准备模型时标题仍显示忙碌图标；需继续精简技术摘要并核对等待状态，保持日志和错误可见。


## 准备页与只读结果追加修复

- 环境摘要保留资源、阶段、进度和耗时；安装文件全名和下载源进入诊断详情。诊断报告补齐尚未进入日志的当前活动，并沿用脱敏；等待用户操作且没有运行步骤时，环境标题不再显示忙碌动效。规范第 6.5 节同步。相关 3 个测试文件共 30 项通过，证据 `setup-refinement-tests.log`。等待状态的新样式仍需在环境依赖未就绪的原生场景复查。
- 只读结果没有可用编辑器或订正契约时隐藏“保存订正”，待确认动作保留；已有可编辑结果和草稿提交行为不变。步骤详情 19 项测试通过（`readonly-result-tests.log`），新的只读待确认界面仍需原生复查。
- 正常首启实际下载 Qwen 后暂停、继续，字节从 1.56 GB 增长到 1.76 GB；全部暂停后确认退出独立应用，重启验证已完成的 3 个模型为可用。剩余 VoxCPM2 显示待准备，用户重新触发准备后从已有约 4.4 GB 继续。没有把重启后的待准备称为暂停状态持久化。证据 `first-run-model-paused.txt/png`、`first-run-model-resumed.txt`、`first-run-paused-before-restart.txt`、`first-run-restart-ready-resources.txt`。
- 首启内置示例中的第二个视频实际播放并暂停于 31 秒；返回原准备流程后下载继续。发现返回按钮误称工作台，已按入口区分“返回准备”和“工作台”，中英日文同步，新构建在原生首启确认“返回准备”并成功返回。证据 `examples-second-playback-dark.png`、`examples-return-setup.txt`。本次 first-run 日志未检出 ResizeObserver loop；此结果仅覆盖本次实际操作。
- 当前插件构建和类型检查通过（`setup-result-build.log`、`setup-result-typecheck.log`）；首启组合及语言检查 19 项通过（`setup-composition-tests.log`）。构建仍有既有两条 CSS 装配警告。
- 根据当前 README 与 `apps/harness/docs/DEVELOPMENT.md` 核实：本分支的正式开发产品为 Electron，`apps/web/src` 为复用业务组件，浏览器入口用于同一 Host 的开发调试；没有独立移动产品入口。桌面窄窗口、内容容器与原生交互验收范围保持。


## 正常准备完成、翻译引导与识别订正

- 正常首启（跳过开关为 0）完成环境与四个模型共 6.97 GB 准备，校验后进入翻译服务配置；明确选择稍后配置后进入工作台。资源页重新检测仍显示全部环境和四个模型可用。证据 `first-run-all-resources-ready.txt/png`、`first-run-translation-light-wide.png`。资源可用性不代表四种推理流程均已实际执行。
- 首启翻译配置的离开动作原先未接入 Harness 服务商编辑器的离开保护。现在共享 View 可委托离开检查，桌面装配传递原有 `registerLeaveGuard`；继续及稍后配置均受保护。正常客户端填写测试 URL 后出现放弃确认，继续编辑保留草稿，明确放弃后才进入工作台。证据 `translation-setup-guard.png`；9 项引导测试、类型检查与构建通过（`translation-onboarding-tests.log`、`translation-guard-typecheck.log`、`translation-guard-build.log`）。未配置真实凭据或进行外部 LLM 调用。
- 原生导入 `asr-review.workflow.json` 并校验通过，从工作台上传隔离样本后提交任务 `58d22b80-72b6-41a3-88b8-ebeab370799c`，实际执行媒体准备与 Whisper tiny CPU 识别。识别结果进入人工确认，首句订正为 `All right, so here we are at the elephants.` 并保存版本 2；返回任务再打开步骤，订正读回。证据 `asr-correction-readback.txt`、`asr-correction-readback-light.png`。只读数据库复核确认原始版本 1 和订正版本 2 均存在，当前仍为 `awaiting_review`，`approvedRevision` 为空，见 `asr-persisted-revisions.json`；确认完成与派生流程仍待验收。
- `asr-original-version-readonly.txt` 和 `translation-setup-draft-retained.txt` 只保存了 AX 差分的无变化结果，不能独立证明对应完整状态；下次原生检查需补存完整 AX。其余已有截图和读回证据按实际范围使用。

## 快捷参数名称一致性与当前验收条件

- 追查首启工作台的“翻译 · 目标语言”后发现它来自快捷控件的无障碍名称；源码与当前构建中的可见短标签已是“译文语言”等。将快捷控件的无障碍名称统一为可见标签，保留同名节点的名称和编号；没有改动语言参数值、保存或执行策略。设计规范第 8 节同步。
- 参数、运行面板、工作台的 3 个测试文件共 48 项通过，Web 类型检查、插件构建和 diff 检查通过。证据 `quick-field-accessible-name-tests.log`、`quick-field-accessible-name-typecheck.log`、`quick-field-accessible-name-build.log`。构建仍有已记录的两条 CSS 装配警告。
- 当前 Mac 锁定，原生工具明确返回无法自动解锁，已请求用户手动解锁。进程 6206 仍存活；未重启客户端、未确认任务、未替换正在运行的插件文件。快捷参数修复已构建，需解锁后在隔离客户端加载并原生复查。全页面验收保持未完成。

## 配置异常文案与业务组件回归

- 节点配置的通用编辑器遇到不支持的字段结构时，错误提示原先固定中文。改为现有中、英、日字典中的一条完整消息，保留具体字段路径和插件编辑器要求；字段支持范围与编辑行为不变。源码证据 `apps/web/src/plugin/builtin/schema-form.tsx`，原生异常态验证仍待完成。
- 配置字段及工作流编辑器 21 项测试通过，Web 类型检查、插件构建与 diff 检查通过；字典检查覆盖 3 种语言、714 个业务键与 7 个框架命名空间，全部通过。证据 `schema-copy-tests.log`、`schema-copy-typecheck.log`、`schema-copy-build.log`、`schema-copy-locales.log`。
- 对本轮跨页面修改补跑 Web 业务组件完整回归：38 个文件、281 项测试全部通过，证据 `web-ui-full-tests.log`。这是组件级检查，未将其计为 Electron 页面或真实流程验收。
- 本次续行再次尝试原生访问，工具仍明确返回 Mac 锁定且无法自动解锁。待用户解锁后，先补存识别版本 1 的完整只读证据并确认版本 2 完成，再加载已构建的语言名称与配置异常文案修复，继续全页面清单。没有改动当前运行实例或测试任务状态。
- 连续第三个目标回合复查仍返回同一锁屏错误，进程 6206 仍存活。现有修改的必要组件检查已完成；剩余渲染、原生交互、主题/窗口状态和全范围验收依赖手动解锁。目标记为受阻，全部未完成项保留，未声明整体完成。解锁后从当前隔离任务继续。

## 解锁后：确认、导出、派生与插槽间距

- 用户手动解锁后恢复原生访问。补存原始版本只读的完整 AX（`asr-original-version-readonly-full.txt`）；选回订正版本 2，点击确认并完成，原任务显示已完成和 2/2 步。重启读回仍已完成，数据库只读复核 `approvedRevision=2`，证据 `asr-confirmed-completed-full.txt`、`asr-confirmed-completed-light.png`、`asr-approved-readback.json`。
- 原生下载识别原始数据，通过系统保存面板存入 `asr-export.json`。下载文件与任务 `asr_raw.json` 的 SHA-256 均为 `f445b0f864101ae49a4079c5da4936497f0f274e15a8765be951ddf30563992f`。该文件为原始识别诊断，保持原始内容；订正另存于结果版本。
- 对已完成识别结果再订正首句，预览保留准备媒体、无需重跑步骤，随后原生创建派生任务 `1210987f-51f8-42d5-803b-fabe8c3b5d12`。新任务显示已完成并读回 `All right, here we are at the elephants.`；原任务仍保留 `All right, so here we are at the elephants.`。证据 `asr-derived-preview-light.png`、`asr-derived-result-full.txt`、`asr-derived-readback.json`；这验证结果复用与派生，不代表重新执行识别或翻译。
- 原生完成页发现生成文件与工作流面板贴合；源码确认 Harness 插槽通过 `display: contents` 包装，原 Page 的直接相邻元素 margin 未作用于实际面板。共享 Page 改为纵向 flex gap，沿用既有 32px token；浅色宽/窄窗口确认恢复间距，证据 `task-page-slot-gap-light-wide.png`、`task-page-slot-gap-light-narrow.png`。结果编辑器与原始数据之间存在同类问题，结果分组改用既有 16px gap；深色宽/窄窗口已确认恢复间距，证据 `result-slot-gap-dark-wide.png`、`result-slot-gap-dark-narrow.png`。任务库与工作流库深色窄窗口也已复查。设计规范第 5.1 节同步。
- 快捷语言参数的无障碍名称在新构建工作台读回为“原文语言、译文语言、导出语言”，证据 `home-language-accessible-names-full.txt`。当前构建已包含配置异常本地化，但对应原生错误状态尚待触发验证。


## SRT 原生上传复测

- 本地字幕配音验收工作流通过原生导入与校验。首次提交失败：`Unsupported MIME type for sourceSubtitles: application/octet-stream`，完整证据 `srt-upload-mime-error-full.txt`。原生查询返回任务不存在，主动放弃本次提交恢复编辑。
- macOS 文件选择器对 SRT 返回空 MIME；浏览器 multipart 转为 octet-stream，而字幕输入只接受字幕/纯文本。对字幕类型输入中扩展名为 `.srt` 且类型为空或 octet-stream 的文件标记 `application/x-subrip`，保持内容、名称和修改时间；已知其他类型保持原校验。
- 新增两种未知 MIME 的表单提交回归，26 项相关测试及客户端构建通过（`srt-upload-tests-rerun.log`、`srt-upload-build-rerun.log`）。初次命令误用 npm workspace 参数，日志保留；改为对应包目录后通过。加载客户端与构建摘要一致。
- 重启后用同一视频和两份 SRT 原生重新提交，任务已成功创建并进入排队；后续确认、配音和导出继续验收。SRT 为人工编写的三句测试数据，不证明翻译服务调用。

### 2026-10-23 原生侧栏与窗口区域迁移（进行中）

- 用户要求直接复用 Harness 侧栏，并重新划分全局导航、窗口栏、页面操作和工作内容。
- 已删除自绘侧栏结构与样式，复用 vendored SidebarRoot / HeaderLeadingControls；保留 YouDub 品牌、五个导航入口、主题/反馈/GitHub、设置以及插件扩展导航。
- PageHeader 通过共享 host 挂载到主区窗口栏，独立 Web 保留原位标题。工作流编辑器去除迁出标题后残留的占位边距。插件管理原页尚待统一。
- 首次原生加载出现侧栏空白：控制台明确报 `ReferenceError: process is not defined at localBuildVersion`。已修复构建缺失的两个版本元信息常量；重新构建并重启后侧栏正常显示。失败没有计为通过。
- 构建与根 TypeScript 检查通过；原生实测任务库导航、收起及再次展开，标题/新建任务动作在窗口栏；折叠后展开和新建入口移到 macOS 控制区。证据 `output/validation/impeccable-20261023/harness-sidebar-collapsed-dark.png`。其余主题、窗口与页面矩阵继续验收。

## Harness 复用审计、品牌红与主页 Logo

- 已完成外壳、主题、标题栏、导航、通用控件的源码归属审计，详见 [Harness 复用审计](harness-reuse-audit.md)。删除自制 rail、固定 52px 标题栏、重复配色、Base UI 对话框和 details 折叠控件；复用原 AppFrame、SidebarRoot、ConversationRoot 样式及 ui-primitives。
- 共享业务页面最终使用 Harness registerFactory / renderFactorySlot；原生任务库、工作流、资源与插件页可打开。两次中间运行失败（重复 children 注册、其他主面板缺插槽权限）已保留诊断，最终候选重新启动验证通过。
- 按用户要求恢复主按钮红色 #e6002e、悬停 #cc0029、白字。浅色/深色已实际显示启用状态的“确认并继续”，证据 native-reuse-red-action-light.png、native-reuse-red-action-dark.png；主窗口中性色和原组件几何保持 Harness 来源。
- 对照冻结版本 f6f927903581b165f2bf6c840ea65b896d319524 的主页源码与 fusion-reference-home.png，确认光学留白扩大 viewBox 后，相同 CSS 外框使可见 Logo 缩小。主页改为红色矩形高等于标题字号 clamp(28px,4vw,48px)，画布高乘 412/300；保留 24px 标题间距。侧栏品牌大小不受本次主页修改影响。
- 更新后的独立原生客户端已截图：native-reuse-hero-large-light.png、native-reuse-hero-large-dark.png、native-reuse-hero-large-collapsed.png。尾尖完整，声波可见；收起后全宽内容居中，点击原生展开入口恢复侧栏。插件构建通过，设计文档和参考 HTML 已同步。
- 最新控件回归首跑 7 文件 64 项中 61 项通过、3 项旧 details 断言失败；改成原生 DisclosureRow 的 aria-expanded 契约后相关 2 文件 26 项通过。TextShimmer 2 项通过，类型检查及框架构建通过。该记录仅覆盖实际执行的检查，剩余业务状态与产物验收继续保留。

## 本地配音完整输出与原生控件追加回归

- 配音节点第二、三段原生音频播放至 4.64 秒、1.6 秒末尾，第一段先前已播放至 2.72 秒。确认原始结果后，任务 7028a542-0aa3-46ea-bffa-b48a63856483 自动完成混音与导出，显示已完成、6/6 步、配音视频 599 KB 和配音音频 3.5 MB。数据库六节点均 completed 且 approvedRevision=1，见 dubbing-approved-readback.json。
- 结果视频实际播放并暂停于 12.6 秒，画面与时间推进；证据 dubbing-completed-playback-dark.png、dubbing-completed-full.txt。通过原生保存面板下载 dubbing-export-verified.mp4，与任务 output/video.mp4 的 SHA-256 均为 2c907a493813a07adc90112ab21bc8ea7dd972140dd4b67c234713031812497c。ffprobe 确认 18.933333 秒、H.264 320×240 和 AAC 48kHz 双声道，文件 613696 字节。本轮字幕为人工验收夹具，没有执行外部翻译调用；播放器推进不代表主观配音质量验收。
- 模型设置采用原生深色表单与未保存确认框。输入 example.invalid 测试 URL 后取消，默认焦点位于继续编辑；返回后 URL 草稿保留，明确放弃后返回空提供商列表。没有保存凭据或请求外部接口，证据 native-reuse-models-dark.png、native-reuse-models-discard-dark.png。
- 工作流删除第一次点击显示确认删除和保留；点击保留退出确认且数据保留。新建空草稿添加准备媒体节点后，撤销恢复空图与禁用运行，重做恢复节点与未保存状态；最后再次撤销并退出，无保存。证据 workflow-redo-readback-full.txt。
- 无效工作流导入原生复现英文格式错误；本地化为简短恢复指引，原始错误保留在 Harness DisclosureRow 诊断详情中。拒绝导入的测试同时断言没有发出创建请求。20 项编辑器测试、类型检查与插件构建通过。重启后重新导入同一无效文件，中文指引和展开后的原始错误均读回，证据 workflow-invalid-import-fixed-dark-narrow.png。

## 续行：窄窗口与原生结果读回

- 在约 857×679 CSS 像素窗口中，主页明暗主题、侧栏展开与完全收起均再次核对；Logo 的尾尖、声波和标题间距完整。证据 native-reuse-hero-large-narrow-dark.png、native-reuse-hero-large-narrow-light.png。
- 资源检测完成后，运行环境与四个模型均显示可用。浅色窄窗口证据 native-reuse-resources-light-narrow-ready.png；同名不带 ready 的早期截图仅记录加载态。
- 插件列表及展开帮助的安装弹窗在浅色窄窗口中没有遮挡，空输入禁用安装；Esc 关闭后焦点回到添加插件。证据 native-reuse-plugins-light-narrow.png、native-reuse-plugin-install-light-narrow.png。本次没有安装或卸载第三方软件。
- 配音任务详情、分段结果和配置在浅色窄窗口中已核对，证据 native-reuse-dubbing-completed-light-narrow.png、native-reuse-dubbing-clips-light-narrow.png、native-reuse-dubbing-config-light-narrow.png。导出音频截图显示 0:16 / 0:18，见 dubbing-export-audio-playback-light.png；该时刻系统 AX 时间字段仍为 0:00，因此不使用 dubbing-export-audio-playback-full.txt 证明时间推进。
- 内置字幕翻译编辑器浅色窄窗口的页头、保存副本、红色运行按钮和工具栏完整；识别节点设置深色窄窗口已查看。证据 native-reuse-workflow-editor-light-narrow.png、native-reuse-node-settings-dark-narrow.png。未修改或保存内置模板。
- 全范围验收仍未完成：隔离 profile 未配置翻译服务，真实翻译和服务连接依赖有效配置；第三方插件实际安装/卸载、任务库多页数据、首启无效目录和资源异常组合仍未取得本轮原生证据。现有截图、组件测试和本地配音完成记录不替代这些项目。

## 系统外观、减少动态效果与语言键盘验证

- 原生 macOS 外观从浅色切到深色，再恢复浅色；YouDub 保持跟随系统并实时更新，未重启。链接输入草稿保持原值，未提交外部请求，随后主动清空。证据 system-follow-light-before.png、system-follow-dark-dynamic.png、system-follow-light-restored.png、system-follow-draft-readback.txt。
- 首轮开启系统减弱动态效果后，主页 Logo 仍在变化：同一区域两帧有 10202 个色彩通道不同，证据 reduced-motion-frame-comparison.json。原因是桌面工具类的 important 动画声明优先于无层的 important 减弱规则；不是缺失系统媒体查询。
- 将既有媒体查询放入 components 层，覆盖 utilities 中的重要声明，同时避免桌面构建移除 base 层。构建通过（reduced-motion-build.log，仍有已记录的两条 CSS 装配警告），独立客户端完整重启后复查。
- 修复后真实系统开关开启时，主页及侧栏 Logo 两帧差异均为 0；关闭后分别有 11852、7776 个通道发生变化。证据 reduced-motion-fixed-comparison.json 及 reduced-motion-fixed-{on,off}-{a,b}.png。系统恢复浅色、减弱动态效果关闭的原始偏好，读回 system-reduced-motion-fixed-restored.txt。
- 通用设置语言菜单通过方向键进入、下移到 English、Enter 确认，焦点回到 English 选择器；Esc 关闭设置后回到 Settings。英文主页在窄窗口侧栏展开/收起均完整换行。证据 settings-english-keyboard.png、home-english-narrow.png、home-english-narrow-expanded.png。菜单在触发器持有焦点时未出现在 macOS AX 树中，方向键进入后菜单项出现在 AX 树；未将前一瞬间的 AX 缺失误判为键盘故障。

## 任务库分页、长名称与空页语义

- 在独立 first-run 数据库加入 22 条明确标注“界面夹具”的终态记录，与原有 3 条真实任务组成 20+5 的两页；没有启动处理、复制凭据或发出外部请求。清单与恢复数据保留于 library-ui-fixtures.json，夹具不计为成功处理证据。
- 原生检查浅色窄窗口、深色宽窗口：多语言及连续长英文文件名在卡片内截断，状态标签保持可见；失败任务详情中的连续长错误完整换行，无横向溢出。证据 library-long-names-light-narrow.png、library-long-names-dark-wide.png、task-long-error-dark-narrow.png。
- 下一页显示 5 条记录并禁用继续翻页；返回上一页恢复首批结果。从第二页键盘切换到排队中，显示筛选空态、移除无用分页并将焦点返回任务状态。证据 library-page-two-native.txt、library-page-two-light-narrow.png、library-empty-filter-native.txt。
- 清理夹具后第二页显示“还没有任务”，与第一页仍存在 3 条记录的事实不符。改为“本页没有任务”，同步中英日字典及设计规范；上一页入口保持。7 项任务库测试、类型检查、三语字典检查和客户端构建通过，日志 library-pagination-*.log。构建保留已有两条 CSS 装配警告。
- 重启实际客户端、恢复夹具并再次清理，修复文案原生读回通过，见 library-empty-last-page-fixed-dark.png、library-empty-last-page-fixed-native.txt。点击上一页后 3 条原任务重新可见，见 library-originals-restored-native.txt。两轮均只清理本轮创建的 22 条记录，原任务 plugin_json 的 SHA-256 未改变，见 library-ui-fixture-cleanup.json。

## 安装目录错误恢复与原生选择器

- 使用独立 installation-errors home / userData 启动正常首启，跳过开关为 0，没有配置成功目录或下载另一套模型。原 first-run 的安装、模型和任务数据保持独立。
- 原生系统选择器选中隔离 home 后，完整路径回填成功；但焦点原先落回整个 HTML 页面。提交相对路径 relative/ui-review 后，表单被连接诊断替代，路径草稿无法直接编辑，见 setup-invalid-directory-before.png / .txt。
- SetupController 将目录提交异常原样抛回安装表单；表单保留输入，在字段附近显示原始错误、关联描述并聚焦目录输入。连接读取异常仍由全局诊断显示，其他准备操作的失败处理不变。选择器结束后返回选择按钮焦点。
- 原生重启复查：相对路径显示“请选择绝对路径的安装目录。”，输入内容及焦点保留；再次输入 / 显示“请为 YouDub 选择独立的文件夹。”，可以继续编辑。目录选择器确定、取消均返回按钮焦点，证据 setup-directory-picker-{selected,cancel}-focus.txt。浅色宽及深色窄窗口截图 setup-invalid-directory-fixed-light.png、setup-invalid-directory-fixed-dark-narrow.png。
- 首次运行 30 项相关测试有 1 项旧 details 结构断言失败；改为 Harness DisclosureRow 的 aria-expanded 和子内容挂载契约后，3 个文件 30 项全部通过。目录错误草稿、纠正后提交、选择器取消/回填焦点、已有连接失败诊断均覆盖。类型检查、插件构建和 diff 检查通过；证据 setup-directory-tests.log、setup-directory-tests-rerun.log、setup-directory-typecheck.log、setup-directory-build.log。

## 环境失败与长诊断布局

- 在独立 installation-errors 配置的 python-version-test 目录建立不符合正常私有 venv 布局的 Python 入口，实际得到 externally-managed-environment 安装拒绝。正常 first-run 环境未改变。最初预期版本拒绝，实际进程报告 3.12.12；本次证据仅证明依赖安装失败，不能用作版本校验结论。原始日志见 setup-python-version-failure.txt，原始宽窗口截图见 setup-python-version-failure-dark-narrow.png（文件名的 narrow 为记录失误，实际 2560×1640）。
- 错误原文直接铺满资源行，挤走后续操作。ResourceRow 改为首行原因摘要与完整诊断折叠区，移除摘要中的子进程路径前缀；原文不变、可聚焦并滚动，重试保持原入口。
- 后续复查使用隔离目录内的确定性失败进程重放同一 stderr（exit 70），不再调用安装器。资源行重试产生新的 09:05:16Z 日志，并继续如实显示失败。见 resource-error-retry-native.txt。该状态属于受控故障验收，不计为真实安装成功。
- 深色宽窗口、浅色窄窗口、键盘 Tab 进入诊断区域并滚动至最后一行均通过，见 resource-error-summary-dark-wide.png、resource-error-summary-light-narrow.png、resource-error-details-scrolled.png、resource-error-details-keyboard.txt。22 项 setup 测试、类型检查与构建通过，日志 resource-error-{tests,typecheck,build}.log。
- 故障客户端已退出，重新启动正常 first-run 配置。后续按用户授权从现有 env 接入翻译服务。


## env 服务接入、真实翻译与订正导出

- 用户授权直接使用 env 配置。复用工作区既有 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL_NAME`，将必要三项写入隔离验收 home 的 `.env`，权限 0600；`env.txt` 已建立硬链接并核实同 inode。Harness 的 `apiKeyEnv` 读取该配置，配置文件不含密钥值。原生模型设置显示环境变量已检测，实际获取到 138 个模型。
- 模型为火山方舟 `doubao-seed-evolving`。实际模型目录返回上下文 1048576、最大输出 262144；本次生成请求明确发送 `maxTokens: 65535`。原始 request/events/response 保持不变。已配置的启动流程直接进入工作台，缺少翻译服务提示消失。
- 真实 19 秒样例任务 `6f286be6-ab3a-445c-a6b1-6ed73f1548b2` 完成媒体准备、识别、翻译、导出 4/4；原生播放器播放到 0:19，生成 H.264/AAC 视频、原文和译文 SRT。原生下载后的译文 SHA-256 与任务产物一致。见 `translation-complete-native.txt`、`translation-result-light-wide.png`、`translation-artifacts.json`。
- 样例 Whisper tiny 将 elephant trunks 识别为 arms，译文随之出现“胳膊”；本轮只订正译文为“鼻子”，未改写原始识别、模型响应或旧任务。通过完成页的订正派生出 `8cd9fc42-5d36-44f7-bfd3-5c3c1f5dba2a`，保留媒体准备与识别、重算导出；新任务完成，0:09 的烧录字幕读回“鼻子”，旧字幕仍为原文。见 `translation-correction-preview.png`、`translation-derived-complete.txt`、`translation-corrected-video-frame.png`。

## 模型目录焦点补修

- 原生发现“获取可用模型”加载时禁用触发按钮，弹窗关闭后焦点落到整个页面。直接修复 Harness `ModelListEditor`：加载使用 `aria-disabled` 保留触发按钮焦点并拒绝重复请求；继续使用原 Modal 的焦点恢复。现有禁用样式同时覆盖该状态。
- 原生取消与 Esc 均回到“获取可用模型”。证据 `model-discovery-cancel-focus.txt`、`model-discovery-escape-focus.txt`；包内中英文 README 和 fork 字节账本同步。
- 框架和产品构建通过。完整 GUI 首轮 7424 项通过，4 个文件因命令未传 `DSH_TEST_PRODUCT_BUNDLE` 导入失败，文档预览许可证打包项超时；保留首轮日志，补齐独立产品 bundle 后复跑这 5 个文件及模型包，14 文件、379 项全部通过。去重共 7445 项通过。证据 `model-focus-framework-build.log`、`model-focus-product-build.log`、`model-focus-gui-tests.log`、`model-focus-gui-rerun.log`。当前裁剪框架仍无 `test:web` 命令，原生验收单独记录。

## 插件安装、启停与卸载

- 通过原生安装弹窗和中国大陆 npm 镜像安装仓库内已审阅的 `@youdub/harness-example-file-transform` 本地夹具。安装成功后启用，扩展导航出现；进入插件页面点击计数从 0 变为 1。停用后扩展导航移除；卸载完成后只剩 YouDub 内置插件。未操作用户原有第三方插件。
- 深色窄窗口检查安装包详情的长名称、版本、组件状态、来源长路径，均完整换行。不存在的本地目录显示“该路径不存在或不是有效的插件包”，输入和安装表单保留。证据 `plugin-local-install-readback.txt`、`plugin-local-enabled-interaction.txt`、`plugin-installed-detail-dark-narrow.png`、`plugin-local-uninstalled.txt`、`plugin-invalid-directory-dark-narrow.png`。

## 收尾：异常页面、配置结构与真实失败重试

- 安装仓库示例改编的本地临时插件 `@youdub/ui-review-edge-fixture`，只用于原生异常路径验收。初版工作流误用了 JSON 类型最终输出且缺少 viewport，工作台如实显示契约错误；补齐 viewport 后，运行校验又拒绝无输出工作流。随后按既有文件输出契约修正夹具，未修改产品校验或业务执行规则。
- 未匹配路径在明暗窄窗口显示“页面不存在”和“返回工作台”，返回成功。配置结构的 rows 数组实际触发本地化插件编辑器提示，完整节点设置和返回画布可用。
- 临时任务 `1d63fbc5-6f74-40f3-952a-4ff809e595cc` 首次执行由故障标记主动抛出 REVIEW_FAILURE，页面如实显示原因及从头重试。明确移除该标记后，点击原生重试完成 attempt 2，输出 28 B 文本 `YouDub native retry accepted`；只读数据库及实际文件一致。此项为受控插件执行验收。见 `task-retry-failure-native.txt`、`task-retry-completed-native.txt`、`task-retry-readback.json`。
- 通用结果显示文件、已确认原始版本及完整原始数据；没有不可用的订正按钮。临时工作流副本保存后，通过列表确认删除，数据库该 ID 计数为 0。
- 证据保存后，原生删除本轮临时故障任务、卸载临时插件，扩展导航和模板移除；五条真实媒体任务保留。客户端恢复中文、跟随系统、展开侧栏和常用窗口，最终工作台没有服务或资源缺失提示。清理读回见 `task-retry-cleanup-native.txt`、`edge-plugin-uninstalled-native.txt`、`final-cleanup-readback.json`。
- 最终对同一业务目录重新运行 Impeccable 源码检测，结果 `[]`（`detector-final.json`）；该工具结果与上述原生证据分别使用。
