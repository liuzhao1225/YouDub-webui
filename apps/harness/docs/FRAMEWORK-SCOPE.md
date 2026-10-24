# Harness 保留范围

更新：2026-10-24。来源见 [upstream.json](../../../vendor/deepseek-harness/upstream.json)。

## 统计口径

原始源码 203 个包，历次裁剪为 156 → 87 → 80 → **70 个**。本轮移除 10 个无实际调用的 Agent、会话及配套包，并清理保留包中的专用分支和依赖。

源码包数按 `vendor/deepseek-harness/source` 中的工作区 `package.json` 统计，不包含仓库根清单。原先“78 个”和上轮“72 个”统计的是开发运行项目链接的包，与源码包总数口径不同；本轮重新生成开发运行项目后为 **62 个运行包**（上轮 72 个）。余下 8 个源码包用于前端编译、桌面构建和类型生成。

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

本轮移除的 10 个包：

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
| @deepseek-ai/dsh-authorization | [packages/credentials/authorization](../../../vendor/deepseek-harness/source/packages/credentials/authorization/package.json) |
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
