# YouDub 前端接入映射

本文按现有功能定位源码。新增页面、官方控件接线、状态与请求、主题及语言维护见[前端开发说明](docs/FRONTEND-DEVELOPMENT.md)。

业务页面直接引用 `apps/web/src` 的原组件，底层使用仓库内维护的 Harness fork，通过官方服务、插槽、组件属性与主题 token 接入。活动源码的修改与裁剪登记在 `vendor/deepseek-harness/fork.json`；原始归档与来源清单保持不变。下方保留历次操作记录；当前通过项、能力边界和剩余验收统一见[代码复核](docs/CODE-AUDIT.md)。

| 用户功能 | 复用的 YouDub 源码 | Harness 接缝 |
| --- | --- | --- |
| 首屏、动态图标、视频链接、本地上传、快捷配置、最近任务 | `plugin/builtin/studio.tsx`、`components/brand/brand-mark.tsx`、`workflow-run.tsx` | `main` / `youdub.page` 插槽；官方页面状态与导航；固定上传端点 |
| 任务库、任务详情、产物、日志、重试/取消/删除/重跑 | `plugin/builtin/library.tsx`、`workflow-task.tsx`、`workflow-rerun.tsx` | 官方 store；`/api/youdub/v2`；`/api/youdub/file` |
| 模板、图编辑、节点配置、输入输出、运行、导入导出 | `plugin/builtin/workflows.tsx`、`workflow-canvas.tsx`、`workflow-settings.tsx` | 官方页面插槽及 store；领域 ReactFlow 保持原组件 |
| 字幕、翻译、音频、节点人工确认 | `plugin/builtin/workflow-task.tsx` | 官方输入/按钮/菜单；原节点草稿、保存、确认、重跑逻辑 |
| 资源检查与准备 | `components/settings-resources.tsx`、`plugin/runtime/workflow-resources.ts` | 官方 API 通道及配置变更事件 |
| 首次环境准备 | `components/setup-gate.tsx`、`setup-screen.tsx`、`runtime/onboarding.ts` | 注入固定 `/api/setup` 请求；官方 `root` priority shadow 承载原页面，ready 后释放并展示原 AppFrame；注入品牌资源、官方主题控件、原示例导航 |
| 首次完整模型准备 | 原 `SetupScreen`、`ModelDownloadRow`、`SetupController` | 四项清单与大小来自原 manifest / resource inventory；四模型均必需，无可取消勾选；官方 Button 显式提交全部模型，复用原暂停、继续、重试与错误行 |
| 示例与同步播放器 | 原 `templates/examples.html` 与 `site/player.js`、`style.css`、`demos.js` | iframe 加载固定官方连接文件端点；只接回应用内返回导航 |
| 语言、主题、设置 | `frontend/theme.tsx` 与官方 `LanguageRow` | 官方 `locale` / `theme` / `sidebar.settings`；主题菜单依次为浅色、深色、跟随系统，新配置默认浅色，跟随系统显示日月图标；侧栏底部从左排列设置、主题、问题反馈、GitHub，四个入口共用前景色；侧栏反馈使用 `bug-report.md`，自动填写版本、系统、架构、页面、语言、主题与客户端信息；环境配置页反馈使用 `setup-problem.md`，填写版本、系统和准备阶段，并复制完整诊断日志 |
| 模型服务与凭据 | 官方 `ui-settings-models` | 官方 settings / credentials / llm 服务，无旧模型设置运行时 |
| 首次翻译服务配置 | 原 `TranslationSetupView`、`TranslationSetupController` | 环境与四模型依赖全部就绪→翻译配置→工作台顺序；配置区使用原官方 ModelsSection，配置完成或用户“稍后配置”后释放 root |
| 插件安装、启停、卸载、日志 | vendor 原 `PluginManagerPage`、`PluginManagerController`、stores、Toast | 官方 PluginManager Remote；仅过滤展示的产品目录与覆盖产品文案 |

## 公共元素

`frontend/controls.tsx` 将原属性名称映射到官方 `Button`、`Input`、`Menu`、`Checkbox`、`Switch`、`SegmentedTabs`、`Tooltip`、`Tag`。按钮和输入框样式提取为原源码公共常量，Web 与 Harness 共用。菜单的焦点、键盘和 Portal 由官方组件负责。原复合 Dialog/Popover 的属性接线由薄适配层转换，模态行为由官方 Modal/Menu 负责。

`frontend/sdk.tsx` 只提供导航链接和原 `domain-helpers` 的纯函数。原 `bootstrap`、Cordis 前端容器、legacy context、router、Base UI 组件和自建模型设置不进入活跃 Harness 客户端。页面按完整路径 key 保留原组件生命周期；静态路由优先级复用原 `resolveRoute`。

第三方原生 Harness bundle 可注册 `youdub.page`（key 是以 `/` 开始的路由）、`youdub.navigation` 以及 `youdub.config.editors`、`youdub.task.detail.panels`、`youdub.task.detail.actions`、`youdub.workflow.node.editors`、`youdub.workflow.node.details`、`youdub.settings.sections`。领域 owner props 保留 request/navigate 等能力；不重启原 YouDub loader。

## 校验边界

- 原分支基线来自 Git 快照 `f6f927903581b165f2bf6c840ea65b896d319524`，在 `.cache/reference` 单独运行前端 3014、后端 8001，数据目录隔离。
- 已用真实页面对照首屏、工作流列表、模板运行面板；修复大标题字体层级、输入框宽度、品牌尺寸、侧栏多余顶部间距、底部设置插槽挤压、查询参数和页面生命周期。
- 环境准备相关 14 项回归测试通过，原 Web TypeScript 检查通过。
- 原始归档字节校验与活动 fork 差异校验分别执行；完整端到端运行与最终产品设置仍按各候选验收，页面截图和编译通过不能替代视频任务完整状态流验收。

## 产品设置与扩展目录

- 通用设置直接沿用官方页面；通过相同 id 的优先级插槽移除仅面向会话的 `font-size` 与 `developer-tools`，`CurrentVersionRow` 直接引用官方源码，构建常量使用应用真实版本 `0.0.7`。
- 模型页及添加提供商、凭据编辑由官方 `ui-settings-models` 完整提供；应用启动关闭该插件可选的 credential onboarding。
- 官方插件管理器保留安装、启停、移除、状态、错误和日志。产品 face 只选择真实第三方及 YouDub 扩展包，不展示无关的 Harness 实验推荐。必需核心包 `@youdub/harness-subtitles` 从安装列表精确排除，内置功能项仍通过原 face 和官方 `plugins.item` 呈现真实版本、状态与错误；没有改写 Host 的 installed 值。原生桌面已核对核心包只显示一张内置功能卡，没有重复安装项或核心停用开关。
- 应用版本 `0.0.7` 与内置 bundle 版本 `0.1.0` 分别显示，未创建虚构市场包或地址。

## 已知原分支测试问题

`graph-studio-draft.test.ts` 中资源检查去重用例期望调用 3 次、实际 2 次。融合代码和冻结快照 `f6f927903581b165f2bf6c840ea65b896d319524` 使用相同依赖均复现相同断言，其他同文件用例通过。本次保留原业务语义；不将基线失败记成融合通过。

## 真实渲染证据

截图在 `docs/evidence/fusion-*.png`。Web 融合页面为 `http://127.0.0.1:3087/`，原版对照为 `http://127.0.0.1:3014/`，二者视口均为 1280×720。原版对照由冻结快照启动，未改源工作树。截图证明页面外观和控件状态；完整模型执行能力以真实后端任务验收为准。

| 文件 | 内容与实际操作 |
| --- | --- |
| `fusion-home-light.png` / `fusion-home-dark.png` | 原动态 Logo、大标题、视频输入、快捷配置；官方主题偏好重启后保持 |
| `fusion-reference-home.png` | 冻结源分支首屏 |
| `fusion-workflows.png` | 合并前四个内置模板的历史画面；当前默认列表为字幕翻译、视频配音、字幕＋配音三项，见下方最新证据 |
| `fusion-workflow-run.png` | 历史人工校对模板“使用”后的运行面板；该独立入口已合并，人工确认由同一节点的“自动下一步”设置决定 |
| `fusion-reference-workflow-run.png` | 原版同模板 `?run=1` 对照 |
| `fusion-settings.png` | 通用设置仅语言、外观、当前版本 0.0.7 |
| `fusion-model-settings.png` | 原官方模型设置界面 |
| `fusion-plugins.png` / `fusion-plugin-details.png` | 官方插件管理与内置 YouDub 的真实版本/运行状态 |

- 最终构建后示例页真实播放从 0:00 推进到 0:15；中文配音切换英文保留进度，暂停和返回工作台正常。证据：`fusion-examples-playing.png`。
- 首屏原文语言菜单经键盘 ArrowDown 打开、Escape 关闭并保留触发器焦点；官方 Menu 负责交互。
- 修复构建/Host 重启期间出现的旧 404/YAML 故障后，中→英→中、官方设置及侧栏主题写入均复测通过。错误曾直接呈现给用户，没有用自动恢复或假数据遮蔽。

- 私有环境切换后的资源页按实际状态报告 Python 3.12.15 可用、推理依赖/FFmpeg/模型待准备；未将未下载模型记为就绪。证据：`fusion-resources.png`。

## 源码桌面实际验收

最新产品首启组合已接 `SetupGate → TranslationSetup → AppFrame`，模型准备仍由原 SetupState/Resources 驱动。原 `TranslationSetupView` 已提取复用；原 Controller 注入 Harness request 后不执行旧登录会话请求。模型区域使用官方 `ModelsSection`、store、operations，经私有子插槽名称映射以避免与设置页的全局插槽声明冲突。官方浏览器 welcome notice 和 DeepSeek 自动引导使用 `settings.onboarding` 同 id 优先级插槽关闭。

原先 source Web 类型检查与 setup / translation / onboarding / plugin runtime 共 31 项测试通过。最新四模型必需门控的 setup / translation / onboarding 共 26 项测试及 Web 类型检查通过，日志 `/tmp/youdub-required-models-frontend-tests.log`：覆盖四模型真实 manifest 名称/用途/总量、移除可取消勾选、旧 Whisper-only 状态仍提交完整清单、保留已下载行与原暂停/继续/重试进度，以及单个模型未完成或四模型已下载但依赖尚在准备时不进入翻译配置。此前修复的迟到 GET 覆盖 prepare 状态回归继续通过。测试没有执行实际大模型下载。

以下为本轮主任务在独立 YouDub 原生窗口中的实际操作记录；`source-development-*.png` 是本轮截图，早期 `fusion-*.png` 继续保留作 Web 与冻结源分支的对照。

| 操作与读回 | 截图或证据 |
| --- | --- |
| 历史 Whisper-only 首启截图保留。当前原生页面已点击“准备全部模型”，在私有目录完成四模型、六项资源要求及相关依赖校验，`phase=ready`、`prepared=true`；历史单模型状态不能绕过完整门控 | [完整首启](docs/evidence/desktop-full-first-run.json)、[旧状态拦截](docs/evidence/desktop-required-model-gate.json)；历史截图 `source-development-first-run.png`、`source-development-model-selection.png`、`source-development-llm-setup.png`、`source-development-home.png` |
| 通用设置显示 YouDub 0.0.7，移除无关字号/代码视图；模型页初始为空，打开官方添加提供商弹窗并取消；核心插件仅显示一张 YouDub 内置功能卡 | `source-development-model-settings.png`；其余为主任务原生交互记录 |
| 真实识别得到 3 段字幕；在 UI 修改第一句并保存到 revision 3，仍停留待确认；重启后订正内容恢复；源音频播放到 19 秒 | `source-development-subtitle-correction.png`；主任务状态读回 |
| 历史人工翻译 fixture 确认后导出、视频播放 14 秒。随后原生导入并运行完整 9 节点真实配音链，视频播放到 11.9 秒；默认文件名已修复，双 SRT 经原生保存框落盘，SHA-256 与 HTTP 产物一致 | 历史截图 `source-development-subtitle-export.png`；[完整媒体链](docs/evidence/source-native-full-dubbing.json)、[播放与原生保存](docs/evidence/source-native-full-dubbing-ui.json) |
| 模板编辑显示原完整 Whisper / tiny / cpu / 禁止自动下一步设置；改名后离开触发官方未保存 Modal，选择继续编辑；保存副本显示已保存，运行打开原面板并显示缺 LLM 的实际原因 | 主任务原生操作记录；E13原格式9节点模板导入已实测，画布拖拽、节点重跑及模板文件导出仍未逐项验收 |
| 工作台切深色、收起侧栏后原动态 Logo 与渐变大标题保持；随后展开并切回浅色。主面板可滚动，左栏固定 | `source-development-home-dark-collapsed.png` |

本轮 `npm --prefix apps/harness test` 在 2026-10-21 21:15 的执行为 40/40 通过，含使用独立临时 application/profile 的 7 项配置语义测试；日志 `/tmp/youdub-fusion-profile-isolated-tests.log`。这份日志仅代表该次源码状态；随后源码SDK链接与锁修复、真实插件安装/卸载已通过，见覆盖账本E10，最终统一回归由主任务记录。

当前四模型的完整准备及本次输入的真实推理已通过；官方模型页面完成提供商保存、模型发现及 65,535 输出上限读回，真实火山方舟翻译与完整配音链有独立证据：[模型配置](docs/evidence/source-native-model-configuration.json)、[真实翻译](docs/evidence/source-native-real-translation.json)、[完整媒体链](docs/evidence/source-native-full-dubbing.json)。已保存密钥卡片摘要的原生重启及关闭重开见 [密钥摘要](docs/evidence/source-native-key-preview.json)；双 SRT 原生保存与哈希见 [播放与保存](docs/evidence/source-native-full-dubbing-ui.json)。早期人工译文 fixture 仅作为对应历史流程证据。YouTube公网下载已通过下方E17原生10节点验收；尚未实机覆盖B站公网下载、官方 Host 字幕文件导入、Vox 预设音色，以及所有任务/工作流 CRUD 和重跑分支；这次输入通过不代表任意输入质量通过。官方 ModelsSection 的 editing/draft 仅在组件内部，Store 和公开子插槽均无 dirty 状态；当前 pending 操作保护保留，未改上游或使用 DOM 探测。隔离模型设置检查见 `docs/MODEL-SETTINGS-VALIDATION.md`。

2026-10-21 新一轮四模型准备观察：原生窗口曾停留 `starting` 的旧画面，同一 Host 的 `/api/youdub/v2` 封装请求已持续返回 `models`、`required=true`、四模型文件就绪且依赖待准备。主任务打开 DevTools 后未刷新页面，画面随即更新并显示“准备全部模型”；Network 连续 37 次请求均为 200，Console 只有开发环境 CSP 警告。源码轮询只在 `ready` 或错误时停止，未因本次现象修改轮询。产品与官方窗口均沿用 Electron 默认后台节流；该事实尚不足以证明本次延迟的根因。

已保存 API Key 摘要通过官方 `settings.models.provider-card` 与首启对应子插槽扩展，支持产品启用的 `llm-pi-ai` 家族（包含自定义提供商）和 `llm-deepseek` 家族。官方编辑器继续只写；YouDub 专用接口根据官方模型配置定位凭据引用，再由官方 `credentials.resolve` 读取，只返回前六位与 `***`，短于等于六位的值只返回 `***`。接口不返回完整密钥，不保存另一份摘要；设置重开与官方凭据更新事件会重新读取。新增官方凭据临时存储保存/重开与接口测试 2 项、摘要 UI 测试 2 项及 Web 类型检查通过；针对性测试未读取实际提供商密钥。主任务随后构建、重启并原生回读实际已保存提供商，关闭设置再打开仍显示正确前缀，完整密钥未显示；见 `docs/evidence/source-native-key-preview.json`。


最新默认模板与下载节点：默认列表合并为字幕翻译、视频配音、字幕＋配音3项；识别和翻译是否暂停由各节点原“自动下一步”设置决定，用户副本与历史任务快照保持。15项模板/图回归见 `/tmp/youdub-merged-workflow-tests.log`，真实默认ID与历史任务核对见 [模板与下载读回](docs/evidence/source-native-youtube-download-node.json)。

原有 `youdub.download` 节点新增 `proxyPort`（0–65535，0直连），原 ConfigEditor 与 Harness 官方 Input 同时用于手动节点设置、工作流运行链接及首页共用入口；`withVideoLink` 将端口写入节点配置，URL只写每次运行输入。旧Composer的 `source_proxy_port` 同样进入原下载 binding。前端51项、localize兼容1项及Web/根类型检查通过，日志 `/tmp/youdub-download-proxy-frontend-tests.log`、`/tmp/youdub-download-proxy-localize-tests.log`、`/tmp/youdub-download-proxy-web-tsc.log`、`/tmp/youdub-download-proxy-root-tsc.log`。原生运行面板粘贴原YouTube zoo链接并填写7897，任务 `874d381f-4750-459a-aa07-ebb1c435715a` 完成下载→准备→原完整配音导出的10节点，实际播放14秒；见 [原生代理输入](docs/evidence/source-native-youtube-proxy-input.png)、[任务及产物](docs/evidence/source-native-youtube-download.json)、[原生回看](docs/evidence/source-native-youtube-download-ui.png)。手动加节点/端口保存由针对性UI测试覆盖；B站公网下载、其他网络条件和全部拖拽连线操作未做原生验收。当前在线素材的实际ASR为long fronts，保持原始响应，流程成功不代表识别准确率通过。
