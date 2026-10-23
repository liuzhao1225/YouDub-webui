# Harness 保留范围

更新：2026-10-23。来源见 [upstream.json](../../../vendor/deepseek-harness/upstream.json)。

## 统计口径

原始源码 203 个包，历次裁剪为 156 → 87 → **80 个**。这次从 87 个继续移除 7 个包，并删除保留包内的闲置组件、工具入口和专用测试。

原先“78 个”统计的是桌面运行项目链接的包。随着未使用依赖移除，这一数字降为 72；其余 8 个源码包用于前端、桌面和构建，不作为独立运行包链接。

| 范围 | 数量 | 依据 |
| --- | ---: | --- |
| 独立运行包 | 72 | 产品 patch、Host 外部导入及其运行依赖，由 prepare-source-development.mjs 生成 |
| 编入前端产物的共享源码 | 6 | 共享组件、插槽、状态、侧栏、插件界面与 Web 入口 |
| 桌面源码 | 1 | 窗口、菜单、preload 与桌面启动 |
| 构建生成器 | 1 | Typert RPC 契约生成 |
| 合计 | 80 | vendor/deepseek-harness/source 内实际 package.json |

源码树共 1414 个文件，10,722,143 字节（约 10.2 MiB）。包含复用的桌面更新调度器；依赖安装目录、构建缓存与本地验收证据不属于上述源码统计。

## 额外 8 个包为何保留

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

本次继续移除：

- 插件管理的闲置 Agent 工具入口及其依赖：tools、working-directory、ptc-runtime、sandbox-policy、user-approval。
- 未使用的 Markdown、Diff、代码高亮、数学公式、文件预览等基础组件及其依赖：code-language、workspace-path、Shiki、KaTeX 和 Markdown 解析器。日志视图、实际表单控件与业务引用的样式继续保留。
- YouDub 中旧版模型服务、模型设置界面、独立静态服务器、旧插件加载器和旧页面外壳；生产入口直接复用当前 Harness 服务与组件。
- 未使用的构建模式、重复的源码校验，以及每次测试前重复安装 Electron 的步骤。

构建从当前源码树生成实际包列表。删除包或包内源码时，同步清理对应旧编译输出，避免增量构建把已删除代码带回产物。框架客户端产物从 184 个降为 44 个，语言语法包和数学字体已移除；此数值统计框架构建产物，不代表安装包文件数或体积。

桌面打包只收录运行模块与资源。YouDub 业务代码使用编译后的 bundle；原先整份 builtin 与 SDK 源码的复制范围缩小为运行时用于执行指纹的 6 个文件。Python 工作进程、模型实现和必要资源继续保留。框架开发源码、测试、source map、构建缓存和本地证据不进入安装包。

今后按实际调用补入需要的内容，不再同步整份上游仓库。现有用户数据迁移仍被使用，予以保留。

## 独立运行包

以下清单来自裁剪后实际生成的 desktop-runtime 项目。“72 个运行包”包含共享服务和契约依赖；包内仍保留实现与对应测试。

| 包 | 源码目录 |
| --- | --- |
| @deepseek-ai/cordis | [vendor/cordis](../../../vendor/deepseek-harness/source/vendor/cordis/package.json) |
| @deepseek-ai/cordis-plugin-group | [vendor/group](../../../vendor/deepseek-harness/source/vendor/group/package.json) |
| @deepseek-ai/cordis-plugin-include | [vendor/include](../../../vendor/deepseek-harness/source/vendor/include/package.json) |
| @deepseek-ai/cordis-plugin-loader | [vendor/loader](../../../vendor/deepseek-harness/source/vendor/loader/package.json) |
| @deepseek-ai/cordis-plugin-timer | [vendor/timer](../../../vendor/deepseek-harness/source/vendor/timer/package.json) |
| @deepseek-ai/cosmokit | [vendor/cosmokit](../../../vendor/deepseek-harness/source/vendor/cosmokit/package.json) |
| @deepseek-ai/dsh | [apps/cli](../../../vendor/deepseek-harness/source/apps/cli/package.json) |
| @deepseek-ai/dsh-agent | [packages/core/agent](../../../vendor/deepseek-harness/source/packages/core/agent/package.json) |
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
| @deepseek-ai/dsh-fs | [packages/fs/fs](../../../vendor/deepseek-harness/source/packages/fs/fs/package.json) |
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
| @deepseek-ai/dsh-sandbox | [packages/sandbox/sandbox](../../../vendor/deepseek-harness/source/packages/sandbox/sandbox/package.json) |
| @deepseek-ai/dsh-scope | [packages/core/scope](../../../vendor/deepseek-harness/source/packages/core/scope/package.json) |
| @deepseek-ai/dsh-session | [packages/core/session](../../../vendor/deepseek-harness/source/packages/core/session/package.json) |
| @deepseek-ai/dsh-session-persistence | [packages/session/session-persistence](../../../vendor/deepseek-harness/source/packages/session/session-persistence/package.json) |
| @deepseek-ai/dsh-session-projection | [packages/session/session-projection](../../../vendor/deepseek-harness/source/packages/session/session-projection/package.json) |
| @deepseek-ai/dsh-settings | [packages/settings/settings](../../../vendor/deepseek-harness/source/packages/settings/settings/package.json) |
| @deepseek-ai/dsh-storage | [packages/storage/storage](../../../vendor/deepseek-harness/source/packages/storage/storage/package.json) |
| @deepseek-ai/dsh-storage-domain | [packages/storage/storage-domain](../../../vendor/deepseek-harness/source/packages/storage/storage-domain/package.json) |
| @deepseek-ai/dsh-subprocess | [packages/subprocess/subprocess](../../../vendor/deepseek-harness/source/packages/subprocess/subprocess/package.json) |
| @deepseek-ai/dsh-subprocess-local | [packages/subprocess/subprocess-local](../../../vendor/deepseek-harness/source/packages/subprocess/subprocess-local/package.json) |
| @deepseek-ai/dsh-system-prompt | [packages/core/system-prompt](../../../vendor/deepseek-harness/source/packages/core/system-prompt/package.json) |
| @deepseek-ai/dsh-timeout | [packages/util/timeout](../../../vendor/deepseek-harness/source/packages/util/timeout/package.json) |
| @deepseek-ai/dsh-typert-loader | [packages/typert/loader](../../../vendor/deepseek-harness/source/packages/typert/loader/package.json) |
| @deepseek-ai/dsh-typert-protocol | [packages/typert/protocol](../../../vendor/deepseek-harness/source/packages/typert/protocol/package.json) |
| @deepseek-ai/dsh-typert-registry | [packages/typert/registry](../../../vendor/deepseek-harness/source/packages/typert/registry/package.json) |
| @deepseek-ai/dsh-util-crypto | [packages/util/crypto](../../../vendor/deepseek-harness/source/packages/util/crypto/package.json) |
| @deepseek-ai/dsh-util-values | [packages/util/values](../../../vendor/deepseek-harness/source/packages/util/values/package.json) |
| @deepseek-ai/dsh-web-app | [packages/bundle/web-app](../../../vendor/deepseek-harness/source/packages/bundle/web-app/package.json) |
| @deepseek-ai/dsh-web-frontend | [apps/web](../../../vendor/deepseek-harness/source/apps/web/package.json) |
| @deepseek-ai/dsh-win32-process | [packages/subprocess/win32-process](../../../vendor/deepseek-harness/source/packages/subprocess/win32-process/package.json) |
| @deepseek-ai/dsh-workspace | [packages/workspace/workspace](../../../vendor/deepseek-harness/source/packages/workspace/workspace/package.json) |
| @deepseek-ai/schemastery | [vendor/schemastery](../../../vendor/deepseek-harness/source/vendor/schemastery/package.json) |

## 验证

本次完成框架、Web、YouDub 业务与桌面构建，TypeScript 检查和产品组成检查通过。保留控件与主题的 25 个测试文件通过；构建清理与打包过滤的 3 项检查，以及旧 API/设置分支删除后的 13 项定向检查通过。真实 Desktop Host 使用隔离 profile 启动成功，首次准备接口正常，未下载模型。

检查了已删除 Markdown 和工具入口的旧编译文件确实消失，Git 未跟踪构建缓存、依赖或产物。本地记录位于 output/harness-followup-prune/，不提交 Git。

本轮未运行长视频、大文件、长文本验证，未运行全量 macOS 检查，未打包、发布或移动现有用户数据。以上构建与启动证据不代表新安装包已经发布。
