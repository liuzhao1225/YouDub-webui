# Harness 保留范围

更新：2026-10-26。来源见 [upstream.json](../../../vendor/deepseek-harness/upstream.json)。

## 按核心功能继续裁剪（2026-10-26）

保留范围从 YouDub 的实际任务出发：媒体导入、识别与翻译、配音与对齐、工作流编排、人工审核、任务产物、资源准备和插件扩展。调用与源码映射见[应用架构](ARCHITECTURE.md#核心功能)。

- 删除没有产品入口的授权登录服务及 LLM 登录桥接，源码包数 **70 → 69**。供应商 API key、现有凭据读取与刷新、DeepSeek 等模型配置继续保留。
- 删除聊天流持久化、重放与压缩记录，以及没有调用的图片计价和截图坐标转发方法。实际翻译继续使用同一 LLM 服务与流装配器。
- 删除旧 Python 翻译、系统密钥库、连接测试与设置写入实现；移除 OpenAI SDK、HTTPX/SOCKS 和 keyring 的直接安装声明。当前模型配置与翻译使用框架服务，历史任务与默认配置的读取迁移保留。
- 删除旧 builtin Settings、Secrets、Processes 实现。图与任务测试接入现有产品服务，避免为测试保留第二套进程/配置实现。
- 删除无调用的麦克风申请、设备信息与聊天文件路径桥接；删除已被 YouDub 打包流程替代的 tarball 安装与全文件 inventory 校验链。窗口、退出、更新检测、插件恢复和当前打包校验保留。
- 删除旧 Base UI、Lucide 和 shadcn 依赖及独立前端配置；Web lock 净移除 294 个节点，没有引入新包或升级版本。实际 CSS 和图标构建使用的 Tailwind PostCSS、Sharp 保留。
- 本次 Python 清理不改变保留提供商的执行行为；更新显式兼容记录，使清理前的任务执行指纹仍可继续使用。没有放宽未知实现的指纹检查。

桌面产品只加载 YouDub 自身入口与运行目录，开发和验收不启动原 DeepSeek Harness 应用。内部包名、IPC/插件合同、已有数据路径及来源许可保留。

验证：框架与产品构建、业务及页面类型、装配和中英日语言检查通过；Python/媒体 122 项、LLM 250 项、桌面 55 项、产品启动/模型/资源 34 项、业务工作流 74 项，共 **535 个唯一测试通过**。1 项 Windows 专用测试在 macOS 跳过。媒体检查初次遇到本机 Homebrew FFmpeg 缺失动态库，改用 YouDub 自带 FFmpeg 后仅重跑失败的 3 项并通过；测试装配的 Context 绑定修复后仅重跑受影响的两个文件。

实际 Electron 首启安装页、明暗工作台、侧栏收放、任务库、工作流列表/画布、资源、插件与设置页面通过截图和交互核对，无页面运行错误。独立测试 profile 使用显式 UI 测试模式检查工作台，不调用外部模型；此轮未重新打包、安装或发布版本。截图和检查记录在本地 `output/core-function-prune/`，不提交 Git。

## 产品残留清理（2026-10-26）

- 删除无调用的 Office 引擎启动解析、旧 Windows 安装器验收脚本、Agent 共享目录助手和失效的 E2E 排除清单。
- 更新功能保留 YouDub 的版本检测、提示和下载入口；移除无调用的应用内安装锁及其 Host IPC、旧安装文案，以及 `electron-updater` 和 4 个独占依赖条目。退出时的任务检查与优雅停止继续使用原实现。
- 删除空的上游官方插件目录及安装目标分支；本地和第三方插件的安装、激活、配置、卸载继续使用现有插件管理器。
- 删除已退出组合的 `llm-deepseek` 专用配置分支和重复编辑视图。DeepSeek 与其他供应商统一使用 `llm-pi-ai`；API 地址、模型目录、凭据、协议适配及共用的模型编辑函数继续保留。
- 移除请求中强制设置 `deepseek-harness` User-Agent 的归因层；保留供应商 SDK 的默认请求行为和用户配置的请求头。
- 清理用户界面与运行错误中的上游产品文案，删除运行时替换品牌名称的包装。框架包名、插件清单与 IPC 协议、已有数据路径和任务指纹继续保留，避免破坏插件与用户数据。许可证和来源记录继续保留。

上一批主要删除包内死代码，当时源码包数为 70；上述后续裁剪减少至 69。包数与删除的代码量分别统计。

验证：框架 Host/Client、Web 与产品桌面入口构建通过；业务与页面类型、装配和中英日语言检查通过。模型目录与请求、插件生命周期、桌面退出/更新、Web 鉴权和子进程的 545 项定向回归通过。本轮未制作或发布新安装包。

## 统计口径

原始源码 203 个包，历次裁剪为 156 → 87 → 80 → 70 → **69 个**。最近一轮删除无入口的授权登录包；其余删除集中在保留包内部。

源码包数按 `vendor/deepseek-harness/source` 中的工作区 `package.json` 统计，不包含仓库根清单。原先“78 个”和上轮“72 个”统计的是开发运行项目链接的包，与源码包总数口径不同；当前重新生成的开发运行项目为 **61 个运行包**（前两轮分别为 72、62 个）。余下 8 个源码包用于前端编译、桌面构建和类型生成。

依赖安装目录、构建缓存与本地验收证据不属于源码包。源码数量和安装包体积分别统计。

## UI 与构建相关源码为何保留

| 包目录 | 实际用途 |
| --- | --- |
| [apps/desktop](../../../vendor/deepseek-harness/source/apps/desktop/package.json) | 桌面窗口、菜单、快捷键与 preload；编入 YouDub 桌面产物。 |
| [packages/client/store](../../../vendor/deepseek-harness/source/packages/client/store/package.json) | 前端组件的共享状态存储。 |
| [packages/client/ui-plugin-manager](../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/package.json) | 插件管理界面及仓库探测 Remote。 |
| [packages/client/ui-primitives](../../../vendor/deepseek-harness/source/packages/client/ui-primitives/package.json) | 实际复用的按钮、图标、弹层等基础组件。 |
| [packages/client/ui-sidebar](../../../vendor/deepseek-harness/source/packages/client/ui-sidebar/package.json) | 侧栏、折叠和标题栏控制组件。 |
| [packages/client/ui-slots](../../../vendor/deepseek-harness/source/packages/client/ui-slots/package.json) | 共享组件插槽与语言契约。 |
| [packages/client/web](../../../vendor/deepseek-harness/source/packages/client/web/package.json) | Web 入口、平台桥接和基础样式。 |
| [packages/typert/generator](../../../vendor/deepseek-harness/source/packages/typert/generator/package.json) | 构建时生成服务与 Remote 的契约；不进入运行项目。 |

## 已移除

- Agent 执行循环、预设清单、聊天与会话控制、定时任务、目标管理、文档预览、内嵌浏览器、插件市场和相应的专用类型、测试。
- 上游发布、基准和完整仓库校验工具；独立更新遮罩及其输入分支。保留 YouDub 实际使用的窗口、菜单、更新入口、插件管理和视频处理功能。
- 全量 source-manifest.json、fork.json、冻结快照验证以及重复源码清单。只保存来源信息、许可证与维护中的源码。
- 历史融合计划、验收截图、模型实验记录移到本地 output/archived-harness-migration/，原始内容保留；output/ 已加入 Git 忽略规则。

前轮已移除：

- 插件管理的闲置 Agent 工具入口及其依赖：tools、working-directory、ptc-runtime、sandbox-policy、user-approval。
- 未使用的 Markdown、Diff、代码高亮、数学公式、文件预览等基础组件及其依赖：code-language、workspace-path、Shiki、KaTeX 和 Markdown 解析器。日志视图、实际表单控件与业务引用的样式继续保留。
- YouDub 中旧版模型服务、模型设置界面、独立静态服务器、旧插件加载器和旧页面外壳；生产入口直接复用当前 Harness 服务与组件。
- 未使用的构建模式、重复的源码校验，以及每次测试前重复安装 Electron 的步骤。

前轮移除的 10 个包：

| 包 | 删除原因 |
| --- | --- |
| `@deepseek-ai/dsh-agent` | Agent 调度、归属和消息投影；YouDub 节点执行由自身工作流和 Jobs 管理。 |
| `@deepseek-ai/dsh-session` | 聊天会话、分叉、历史与修复。 |
| `@deepseek-ai/dsh-system-prompt` | Agent 系统提示装配。YouDub 翻译继续使用现有 LLM 服务。 |
| `@deepseek-ai/dsh-session-persistence` | 聊天会话落盘；YouDub 任务和产物已有自身持久化。 |
| `@deepseek-ai/dsh-session-projection` | 会话视图与投影。 |
| `@deepseek-ai/dsh-workspace` | Agent 工作区服务。 |
| `@deepseek-ai/dsh-fs` | 已无调用的工作区文件服务。 |
| `@deepseek-ai/dsh-sandbox` | 已无调用的 Agent 沙箱服务。 |
| `@deepseek-ai/dsh-storage` | 随会话存储移除后无消费者的存储抽象。 |
| `@deepseek-ai/dsh-storage-domain` | 随会话存储移除后无消费者的存储域。 |

保留包内同时移除 Jobs 的 Agent/会话归属与通知、会话遥测启动 patch、Agent 远端 waterfall、终端字号与字体设置和相应专用依赖。通用 RPC、Context 映射、双向流、资源权限、插件安装启停卸载、Profile 合成及生命周期继续使用 Harness 原实现。`scope` 保留连接所需的子 Context 释放机制；`attachment` 保留现有 LLM 与通信契约所引用的类型。

构建从当前源码树生成实际包列表。删除包或包内源码时，同步清理对应旧编译输出，避免增量构建把已删除代码带回产物。上轮框架客户端产物从 184 个降为 44 个，语言语法包和数学字体已移除；此数值统计框架构建产物，不代表安装包文件数或体积。

桌面打包只收录运行模块与资源。YouDub 业务代码使用编译后的 bundle；原先整份 builtin 与 SDK 源码的复制范围缩小为运行时用于执行指纹的 6 个文件。Python 工作进程、模型实现和必要资源继续保留。框架开发源码、测试、source map、构建缓存和本地证据不进入安装包。

今后按实际调用补入需要的内容，不再同步整份上游仓库。现有用户数据迁移仍被使用，予以保留。

## 保留的运行基础与共享契约源码

以下清单保留实际服务、通信和共享契约。运行项目的最终包数以本轮构建输出为准；上面的 UI 与构建相关源码单独列出。

| 包 | 源码目录 |
| --- | --- |
| @deepseek-ai/cordis | [vendor/cordis](../../../vendor/deepseek-harness/source/vendor/cordis/package.json) |
| @deepseek-ai/cordis-plugin-group | [vendor/group](../../../vendor/deepseek-harness/source/vendor/group/package.json) |
| @deepseek-ai/cordis-plugin-include | [vendor/include](../../../vendor/deepseek-harness/source/vendor/include/package.json) |
| @deepseek-ai/cordis-plugin-loader | [vendor/loader](../../../vendor/deepseek-harness/source/vendor/loader/package.json) |
| @deepseek-ai/cordis-plugin-timer | [vendor/timer](../../../vendor/deepseek-harness/source/vendor/timer/package.json) |
| @deepseek-ai/cosmokit | [vendor/cosmokit](../../../vendor/deepseek-harness/source/vendor/cosmokit/package.json) |
| @deepseek-ai/dsh | [apps/cli](../../../vendor/deepseek-harness/source/apps/cli/package.json) |
| @deepseek-ai/dsh-api-gateway | [packages/api/gateway](../../../vendor/deepseek-harness/source/packages/api/gateway/package.json) |
| @deepseek-ai/dsh-api-remote-access | [packages/api/remote-access](../../../vendor/deepseek-harness/source/packages/api/remote-access/package.json) |
| @deepseek-ai/dsh-api-remotes | [packages/api/remotes](../../../vendor/deepseek-harness/source/packages/api/remotes/package.json) |
| @deepseek-ai/dsh-api-settings-controller | [packages/api/settings-controller](../../../vendor/deepseek-harness/source/packages/api/settings-controller/package.json) |
| @deepseek-ai/dsh-app-boot | [packages/boot/app-boot](../../../vendor/deepseek-harness/source/packages/boot/app-boot/package.json) |
| @deepseek-ai/dsh-atomic-write | [packages/util/atomic-write](../../../vendor/deepseek-harness/source/packages/util/atomic-write/package.json) |
| @deepseek-ai/dsh-attachment | [packages/attachment/attachment](../../../vendor/deepseek-harness/source/packages/attachment/attachment/package.json) |
| @deepseek-ai/dsh-brand | [packages/util/brand](../../../vendor/deepseek-harness/source/packages/util/brand/package.json) |
| @deepseek-ai/dsh-client-connection | [packages/client/connection](../../../vendor/deepseek-harness/source/packages/client/connection/package.json) |
| @deepseek-ai/dsh-client-hmr | [packages/client/hmr](../../../vendor/deepseek-harness/source/packages/client/hmr/package.json) |
| @deepseek-ai/dsh-client-locale | [packages/client/locale](../../../vendor/deepseek-harness/source/packages/client/locale/package.json) |
| @deepseek-ai/dsh-client-modules | [packages/client/modules](../../../vendor/deepseek-harness/source/packages/client/modules/package.json) |
| @deepseek-ai/dsh-client-shortcuts | [packages/client/shortcuts](../../../vendor/deepseek-harness/source/packages/client/shortcuts/package.json) |
| @deepseek-ai/dsh-client-ui-layout | [packages/client/ui-layout](../../../vendor/deepseek-harness/source/packages/client/ui-layout/package.json) |
| @deepseek-ai/dsh-client-ui-renderer | [packages/client/ui-renderer](../../../vendor/deepseek-harness/source/packages/client/ui-renderer/package.json) |
| @deepseek-ai/dsh-client-ui-settings | [packages/client/ui-settings](../../../vendor/deepseek-harness/source/packages/client/ui-settings/package.json) |
| @deepseek-ai/dsh-client-ui-settings-general | [packages/client/ui-settings-general](../../../vendor/deepseek-harness/source/packages/client/ui-settings-general/package.json) |
| @deepseek-ai/dsh-client-ui-settings-models | [packages/client/ui-settings-models](../../../vendor/deepseek-harness/source/packages/client/ui-settings-models/package.json) |
| @deepseek-ai/dsh-client-ui-theme | [packages/client/ui-theme](../../../vendor/deepseek-harness/source/packages/client/ui-theme/package.json) |
| @deepseek-ai/dsh-cmdline | [packages/boot/cmdline](../../../vendor/deepseek-harness/source/packages/boot/cmdline/package.json) |
| @deepseek-ai/dsh-config-editor | [packages/boot/config-editor](../../../vendor/deepseek-harness/source/packages/boot/config-editor/package.json) |
| @deepseek-ai/dsh-credentials | [packages/credentials/credentials](../../../vendor/deepseek-harness/source/packages/credentials/credentials/package.json) |
| @deepseek-ai/dsh-credentials-local | [packages/credentials/credentials-local](../../../vendor/deepseek-harness/source/packages/credentials/credentials-local/package.json) |
| @deepseek-ai/dsh-deque | [packages/util/deque](../../../vendor/deepseek-harness/source/packages/util/deque/package.json) |
| @deepseek-ai/dsh-desktop-host | [apps/desktop-host](../../../vendor/deepseek-harness/source/apps/desktop-host/package.json) |
| @deepseek-ai/dsh-hmr | [packages/boot/hmr](../../../vendor/deepseek-harness/source/packages/boot/hmr/package.json) |
| @deepseek-ai/dsh-home-paths | [packages/util/home-paths](../../../vendor/deepseek-harness/source/packages/util/home-paths/package.json) |
| @deepseek-ai/dsh-host-frontend-static | [packages/host/frontend-static](../../../vendor/deepseek-harness/source/packages/host/frontend-static/package.json) |
| @deepseek-ai/dsh-host-plugin-inventory | [packages/host/plugin-inventory](../../../vendor/deepseek-harness/source/packages/host/plugin-inventory/package.json) |
| @deepseek-ai/dsh-host-webserver | [packages/host/webserver](../../../vendor/deepseek-harness/source/packages/host/webserver/package.json) |
| @deepseek-ai/dsh-http-proxy | [packages/util/http-proxy](../../../vendor/deepseek-harness/source/packages/util/http-proxy/package.json) |
| @deepseek-ai/dsh-jobs | [packages/jobs/jobs](../../../vendor/deepseek-harness/source/packages/jobs/jobs/package.json) |
| @deepseek-ai/dsh-jobs-local | [packages/jobs/jobs-local](../../../vendor/deepseek-harness/source/packages/jobs/jobs-local/package.json) |
| @deepseek-ai/dsh-launch-environment | [packages/util/launch-environment](../../../vendor/deepseek-harness/source/packages/util/launch-environment/package.json) |
| @deepseek-ai/dsh-lazy-require | [packages/util/lazy-require](../../../vendor/deepseek-harness/source/packages/util/lazy-require/package.json) |
| @deepseek-ai/dsh-llm | [packages/llm/llm](../../../vendor/deepseek-harness/source/packages/llm/llm/package.json) |
| @deepseek-ai/dsh-llm-pi-ai | [packages/llm/llm-pi-ai](../../../vendor/deepseek-harness/source/packages/llm/llm-pi-ai/package.json) |
| @deepseek-ai/dsh-native-command | [packages/util/native-command](../../../vendor/deepseek-harness/source/packages/util/native-command/package.json) |
| @deepseek-ai/dsh-package-manifest | [packages/util/package-manifest](../../../vendor/deepseek-harness/source/packages/util/package-manifest/package.json) |
| @deepseek-ai/dsh-plugin-manager | [packages/boot/plugin-manager](../../../vendor/deepseek-harness/source/packages/boot/plugin-manager/package.json) |
| @deepseek-ai/dsh-scope | [packages/core/scope](../../../vendor/deepseek-harness/source/packages/core/scope/package.json) |
| @deepseek-ai/dsh-settings | [packages/settings/settings](../../../vendor/deepseek-harness/source/packages/settings/settings/package.json) |
| @deepseek-ai/dsh-subprocess | [packages/subprocess/subprocess](../../../vendor/deepseek-harness/source/packages/subprocess/subprocess/package.json) |
| @deepseek-ai/dsh-subprocess-local | [packages/subprocess/subprocess-local](../../../vendor/deepseek-harness/source/packages/subprocess/subprocess-local/package.json) |
| @deepseek-ai/dsh-timeout | [packages/util/timeout](../../../vendor/deepseek-harness/source/packages/util/timeout/package.json) |
| @deepseek-ai/dsh-typert-loader | [packages/typert/loader](../../../vendor/deepseek-harness/source/packages/typert/loader/package.json) |
| @deepseek-ai/dsh-typert-protocol | [packages/typert/protocol](../../../vendor/deepseek-harness/source/packages/typert/protocol/package.json) |
| @deepseek-ai/dsh-typert-registry | [packages/typert/registry](../../../vendor/deepseek-harness/source/packages/typert/registry/package.json) |
| @deepseek-ai/dsh-util-crypto | [packages/util/crypto](../../../vendor/deepseek-harness/source/packages/util/crypto/package.json) |
| @deepseek-ai/dsh-util-values | [packages/util/values](../../../vendor/deepseek-harness/source/packages/util/values/package.json) |
| @deepseek-ai/dsh-web-app | [packages/bundle/web-app](../../../vendor/deepseek-harness/source/packages/bundle/web-app/package.json) |
| @deepseek-ai/dsh-web-frontend | [apps/web](../../../vendor/deepseek-harness/source/apps/web/package.json) |
| @deepseek-ai/dsh-win32-process | [packages/subprocess/win32-process](../../../vendor/deepseek-harness/source/packages/subprocess/win32-process/package.json) |
| @deepseek-ai/schemastery | [vendor/schemastery](../../../vendor/deepseek-harness/source/vendor/schemastery/package.json) |

## 验证

2026-10-24 本轮裁剪后完成：

- 框架 Host、Client、Web 和 YouDub 业务、Electron 入口构建通过；完整 Host/Client TypeScript、产品 TypeScript、产品组成检查通过。
- Jobs、Scope、Profile、PluginManager、HMR、Typert、LLM 和桌面退出检查的 20 个测试文件共 492 项通过。修正一处测试夹具漏声明的 `jobs` 依赖后，仅重跑该文件。
- 权限快照、客户端连接、共享控件与更新界面的 5 个文件共 38 项通过；桌面退出及 LLM 序列化测试 36 项通过。
- 产品测试 68 项通过。两项桌面启动检查最初因本地依赖链接指向另一个工作树而失败，改成本工作树的独立依赖目录后，这两项重跑通过。
- 使用真实 Desktop Host、独立 profile 和浏览器验证：插件安装、激活、自定义节点界面、工作流人工订正、导出文件下载回读、停用、重新启用、卸载全部通过，浏览器无运行错误。此验收复用原有 `graph-text-review` 示例，不调用外部模型或下载模型。

本地日志、界面截图和 `acceptance.json` 位于 `output/agent-runtime-prune/`，不提交 Git。本轮没有生成或发布安装包；源码与运行包减少量不代表 DMG 体积减少量。
