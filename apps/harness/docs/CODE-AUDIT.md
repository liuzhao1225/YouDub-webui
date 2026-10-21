# YouDub Desktop 代码复核

本次结论：运行中的前后端框架与 Electron 能力来自保留的 Harness 源码；发现并修正了无关后台模块仍被加载、账号平台仍在桌面入口接线的问题。原 YouDub 的业务能力有逐项映射和回归证据，仍有明确的实机验收与发行能力缺口，不能签署“所有功能全部验收通过”。

## 比较范围与证据

- 原 YouDub 冻结快照：`f6f927903581b165f2bf6c840ea65b896d319524`，58 条 API、11 个媒体操作、11 个 Python worker 操作、9 个页面入口、50 组元素源文件；重新执行 [清单校验](../baselines/inventory.mjs) 通过。[冻结清单](../baselines/youdub-source-inventory.json)
- Harness：公开源码 `dsh-v0.2.1-rc.2` / `687f282e8625c6b8d11ff58211a90524be2e4317`。官方源码、原应用、npm 包与 YouDub 初始快照分别校验，保存记录未改。[来源基线](../baselines/sources.json)
- 审核当前入口、产品组合、实际构建输入及其与冻结业务代码的差异。Host 插件中 42 个有输出字节的模块，Client 插件中 269 个；完整上游档案和未进入产物的旧应用代码作为参考保留。模块数量不代表功能通过率。[构建边界检查](../check-composition.mjs)
- 本轮无安装包制作、发布或外部 LLM 调用。构建结果为工作区源码开发应用；独立数据目录与源码运行时不依赖已安装的 DeepSeek Harness.app。[源码启动器](../desktop.mjs)

## 已修复的问题

| 发现 | 修复 | 验证 |
| --- | --- | --- |
| 隐藏聊天页面后，后台仍组合编码 Agent、终端、子智能体、计划任务、网页工具等 | 在 YouDub patch 中新增 66 个明确停用项；覆盖四个单独加载的 Agent 预设。未修改上游 bundle | 官方 parser/composeEntries 回归；实际 PluginManager 读回所有启用条目均 active，无 pending/failed |
| 官方模型服务的默认选择仍指向不存在的 DeepSeek 预置路由 | 产品默认 provider/model 设为空；用户保存的模型仍由官方设置层覆盖 | 干净 profile 组合断言；实际模型页面仅显示用户已有的提供商 |
| YouDub Electron 主入口仍创建 DeepSeek PlatformView、账号 session 回调、用量/充值 IPC | 删除这组产品层接线及账号 preload 的输出复制 | 桌面构建输入检查禁止 platform-view；官方预加载和窗口代码原样校验 |
| 四项测试仍期待旧产品行为 | 默认模板数改为 3；侧栏不再期待语言控件；返回相同资源需求复用已完成检查 | 完整领域/前端回归通过，保留各测试原有状态、并发与错误断言 |

修改位置：[产品组合](../cordis.patch.yml)、[桌面入口](../src/desktop-product.ts)、[profile 回归](../test/profile.test.mjs)。

## 保留的 Harness 服务为何必要

| 基础能力 | 官方实现与使用者 |
| --- | --- |
| 启动、插件与配置 | app-boot、Cordis Loader、PluginManager、config-editor/settings；产品只提供 patch 和业务插件 |
| 桌面窗口和通信 | DesktopHostProcess、DesktopBackendController、官方 preload、协议转发、原生目录选择、退出保护、快捷键；createWindow/Windows 菜单复制块逐字校验 |
| 权限边界 | 官方 Connection / Credentials / RemoteAccess / fs-sandbox，以及原有桌面媒体权限处理。即使 YouDub 没有录音入口，权限检查仍须保留 |
| 前端框架 | 官方 Renderer、Slots、Layout、Store、locale、theme、primitives；原 YouDub 页面通过业务插槽和控件属性适配接入 |
| 模型管理 | 官方 ModelsSection、configForms、Credentials、llm、llm-pi-ai；翻译继续经过官方 LLM，输出上限至少 65,535 |
| 官方设置的依赖 | ModelsSection 要求 remote.session；SessionController 又要求 session、agent registry、attachments、workspace registry 等。保留这些依赖，没有启动 coding agent-loop、tools 或聊天界面 |
| 媒体执行 | 官方 Subprocess 和 Jobs 管理进程、取消和运行状态；YouDub 保留图调度、SQLite 事务、文件产物、Python 协议、媒体算法 |
| 插件管理 | 复用官方 PluginManagerPage/Controller，产品组合展示 YouDub 内置能力和已安装扩展；尚无已发布的 YouDub 在线市场服务 |

旧 HTTP/Auth、旧 Cordis 根、旧 React 根、旧扩展加载器、旧模型设置页面未进入融合产品的活动构建输入。原源码和旧发行脚本仍在仓库中用于保留初始状态；`npm start` / `npm run dev` 进入融合应用。旧 `build:mac` / `build:windows` 发行流程不能用来证明当前 Harness 应用已具备安装与更新交付能力。

## YouDub 覆盖与当前验收范围

详细端点/元素映射沿用 [功能账本](FUSION-COVERAGE.md) 和 [前端映射](../FRONTEND-MAPPING.md)，本轮补充证据见 [审计读回](evidence/code-audit.json)。

同一 Host 的 IAB 插件页面：[实际截图](evidence/code-audit-plugins.png)。

| 能力 | 本轮核对 |
| --- | --- |
| 视频/链接导入、下载节点与代理端口 | 源合同及回归通过；历史 YouTube zoo 的十节点真实任务和四个产物仍可读取；本轮未重复远端下载 |
| Demucs、Whisper、分句、翻译、VoxCPM、Qwen 对齐、混音与导出 | 11 个原媒体操作保留；实际四模型 ready；历史完整媒体链证据保留。本轮 Python 525 项通过，没有用测试通过代替所有输入质量验收 |
| 字幕文件导入 | 当前真实 Host 上传双 SRT 与 zoo 视频，经原 Python worker 导入、人工确认、FFmpeg 导出成功；未新增算法实现 |
| 工作流管理 | 当前 Host 创建/读取/修改/删除、旧修订冲突返回 409；默认三模板，人工确认仍由节点 autoContinue 控制 |
| 任务状态机 | 当前 Host 的审核暂停、批准及动作回执、取消后拒绝继续、错误 SRT 的显式 retry 均通过 |
| 中间结果复用 | 当前 Host rerun-preview / rerun 复用结果；需要人工确认的节点仍要求新任务确认；删除本轮源测试任务后派生结果可读 |
| 任务历史与媒体文件 | 历史完整 YouTube 任务仍 succeeded，MP4/WAV/双 SRT 的 Range 请求均 206；原任务未修改 |
| 首启与资源 | 回归验证未完成四模型/依赖不能放行；当前私有环境四模型均 ready |
| UI 与多语言 | 当前 Host 的工作台、日语通用/模型设置、官方插件管理实际打开；无 DeepSeek 账号、充值、聊天、代码工作区入口；模型仅显示已有用户配置 |
| 扩展 | 官方隔离 profile 安装/卸载和链接保持回归通过；历史 JS Host/Python/Client 插件运行证据保留；本轮未重新安装业务插件到用户 profile |

本轮实测创建的工作流及任务已清理，未删除历史业务任务。测试脚本经历两次图校验拒绝（缺少最终产物、关闭字幕后未提供音轨），以及一次“复用结果仍需人工确认”的预期修正；这些都来自真实合同，未通过改业务代码绕过。最终验收脚本按正确合同运行完成。

## 尚未通过的完整产品验收

1. **安装与更新：实现/发行缺口。** 当前开发壳没有 YouDub 更新源。用户要求暂不打包，本轮保持该边界；不能称为已完成安装、自动更新或可分发自包含应用。开发运行依赖本仓库的源码构建及官方 runtime payload。
2. **原生交互：本轮受阻。** Mac 锁屏，原生保存/选择文件框、窗口操作、部分画布拖拽与菜单焦点未重新验收。IAB 验证只证明同一 Host 的前端可用。
3. **真实输入覆盖：仍待实测。** B 站公网下载、Vox 预设音色、所有媒体输入与语言/平台组合没有完整实机覆盖。保留既有源测试和成功样本，不能扩大其结论。
4. **官方模型表单草稿：公开能力限制。** 官方组件未向公开 Store/子插槽暴露 editing/draft；当前有 pending 操作保护，未实现未保存草稿关闭确认。保持上游原样，未做 DOM 探测补丁。
5. **插件分发：发布缺口。** 具备官方安装/启停/卸载机制和 YouDub 业务扩展接口；在线 YouDub 市场目录与发行源尚未建立。旧 `package.youdub` 插件需要转换为官方 dsh bundle 声明。

## 验证结果

- Harness 接入：57 passed；最终四预设停用后 profile 专项 10 passed（包含在同一测试组，不重复计数）。
- 领域/API/图调度：172 passed，1 skipped（Windows 子进程取消，当前 macOS）。
- 前端：245 passed / 36 files。
- Python：525 passed。
- 根与 Web 类型检查通过；产品构建、活动模块检查通过。
- 官方完整性：9,817 个 vendor 源文件、362 个源码运行时包、360 个 npm 基线包、原 Desktop 6,438 个文件与保存副本、YouDub 初始快照及原生复制块校验通过。
- 最终运行 inventory：52 个启用条目，全部 active；四个本地模型 ready。数量包含官方 include 入口，不是 YouDub 功能数量。

本报告是代码审计及明确范围内的回归结论。剩余验收项保留开放状态。
