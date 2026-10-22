---
description: "web GUI 浏览器侧的包映射：外壳启动、浏览器与宿主通信、共享客户端服务、本地化、开发重载与 UI 功能插件。"
kind: "package-group"
---

# client/ — Web GUI 浏览器侧

[English](README.md) | 中文

## 概述

`client/` 组提供 dsh web GUI 的浏览器体验，包括对话、导航、设置、批准、文件访问及其他交互功能。添加浏览器中可见的行为时，请选择本系列中的包；服务端页面交付与宿主集成则使用 [`host/`](../host/README.zh.md)。本系列同时涵盖共享浏览器基础与专门的 UI 功能，各子包 README 拥有其配置与行为说明。编写规则见 [AGENTS.md](AGENTS.md)，下方相关文档解释跨包组合方式。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

内核包负责启动与服务于页面，UI 功能包负责呈现页面。各包的 README 拥有自己的约定与配置。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`web/`](web/README.zh.md) | 启动浏览器外壳 | — |
| [`modules/`](modules/README.zh.md) | 加载浏览器侧客户端模块 | `ctx.clientModules` / `ctx.modules` |
| [`connection/`](connection/README.zh.md) | 维护浏览器与宿主之间的 RPC 通信与事件投递 | `ctx.connection` |
| [`file-upload/`](file-upload/README.zh.md) | 在页面线程之外发送原始 Blob 与字节流请求体 | `ctx.fileUpload` |
| [`shortcuts/`](shortcuts/README.zh.md) | 注册应用键盘命令 | `ctx.shortcuts` |
| [`store/`](store/README.zh.md) | 提供不依赖 React 的 observable 与快照存储原语 | — |
| [`hmr/`](hmr/README.zh.md) | 在开发期间刷新客户端插件 | — |
| [`locale/`](locale/README.zh.md) | 提供本地化偏好与消息词典 | `ctx.locale` |
| [`test-runtime/`](../test-support/client-runtime/README.zh.md) | 为客户端功能包提供共享的仓库测试支持 | — |
| [`ui-renderer/`](ui-renderer/README.zh.md) | 将 slot 数据绑定到 React，并挂载组装完成的应用 | `ctx.uiRenderer` |
| [`ui-slots/`](ui-slots/README.zh.md) | 定义类型化扩展 Slots 与可复用 Component Factory | — |
| [`ui-session/`](ui-session/README.zh.md) | 把会话控制器状态适配为标准 Slot source 与钩子 | — |
| [`ui-theme/`](ui-theme/README.zh.md) | 应用所选颜色主题 | — |
| [`ui-primitives/`](ui-primitives/README.zh.md) | 提供共享 React 控件、图标与内容渲染器 | — |
| [`ui-layout/`](ui-layout/README.zh.md) | 排列应用的主要区域 | — |
| [`ui-dockkit/`](ui-dockkit/README.zh.md) | 提供停靠布局操作与 React 组件 | — |
| [`ui-sidebar/`](ui-sidebar/README.zh.md) | 展示工作区与会话导航 | — |
| [`ui-sidebar-right/`](ui-sidebar-right/README.zh.md) | 管理右侧 Sidebar 及其 tab 类型 | `ctx.sidebarRight`, `ctx.sidebarRightTabs` |
| [`ui-sidebar-documentpreview/`](ui-sidebar-documentpreview/README.zh.md) | 在右侧 Sidebar 的 tab 中显示文档 | `ctx.documentPreviews` |
| [`ui-sidebar-browser/`](ui-sidebar-browser/README.zh.md) | 在右侧 Sidebar tab 中浏览 sandboxed HTTP(S) 页面，包括 loopback 服务 | — |
| [`resources/`](resources/README.zh.md) | 统一资源模型：`useResource` 会话标准钩子背后的协议提供方 | `ctx.resources` |
| [`ui-sidebar-files/`](ui-sidebar-files/README.zh.md) | 右侧 Sidebar 的工作区文件树 tab 类型 | — |
| [`ui-workspace/`](ui-workspace/README.zh.md) | 提供工作区选择与创建界面 | — |
| [`ui-conversation/`](ui-conversation/README.zh.md) | 展示当前对话及其输入界面 | — |
| [`ui-chat/`](ui-chat/README.zh.md) | 投影并渲染 Chat 对话 target | — |
| [`ui-approval/`](ui-approval/README.zh.md) | 展示批准请求并返回用户决策 | — |
| [`ui-tool/`](ui-tool/README.zh.md) | 编排工具调用树与按工具键控的视图 | — |
| [`ui-goal/`](ui-goal/README.zh.md) | 展示与管理当前目标 | — |
| [`ui-commands/`](ui-commands/README.zh.md) | 提供会话感知的命令发现与分发 | — |
| [`ui-input-trigger/`](ui-input-trigger/README.zh.md) | 协调内联命令与引用建议 | — |
| [`ui-skill/`](ui-skill/README.zh.md) | 向内联建议添加 skill（技能）引用 | — |
| [`ui-reference/`](ui-reference/README.zh.md) | 统一的 Web `@file` / `@session` 引用 source | — |
| [`ui-settings/`](ui-settings/README.zh.md) | 承载设置界面及其扩展区域 | — |
| [`ui-settings-general/`](ui-settings-general/README.zh.md) | 提供常规设置分区 | — |
| [`ui-settings-models/`](ui-settings-models/README.zh.md) | 提供模型提供方配置与 DeepSeek 引导 | — |
| [`ui-plugin-manager/`](ui-plugin-manager/README.zh.md) | 贡献侧栏的“插件”面板：安装、启用、停用、重试与组合已安装的包 | — |
| [`ui-deliverables/`](ui-deliverables/README.zh.md) | 生成改动文件卡片及其对比 tab、交付文件卡片与可点击的最终响应文件引用 | — |
| [`ui-message-feedback/`](ui-message-feedback/README.zh.md) | 提供消息赞踩，以及从赞踩、`/feedback` 或会话标题栏菜单打开的反馈弹窗 | `ctx.feedbackUi` |
| [`ui-directory-picker-browse/`](ui-directory-picker-browse/README.zh.md) | 面向工作区目录流程的应用内目录浏览界面 | — |
| [`ui-directory-picker-native/`](ui-directory-picker-native/README.zh.md) | 驱动本地 Desktop 或 Host OS 选择器的原生目录选择界面 | — |
| [`ui-open-in-app/`](ui-open-in-app/README.zh.md) | 在已安装应用中打开工作区目录的会话标题栏拆分按钮，以及文档预览里用默认应用打开单个文件的控件 | — |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考与两份拥有跨包组合决策的 Agent Note 读起，再看服务于本页的宿主半侧。

- [客户端模块子系统](../../docs/subsystems/client-modules.md)——web 插件表：`dsh.client` 声明、启动图协议与 bundle 路由。
- [slot 系统标准](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)——权威 slot 模型：注册、props 份额与存储。
- [web 客户端架构 reference](../../docs/subsystems/web-client.md)——加载链、对象层与客户端服务。
- [宿主组地图](../host/README.zh.md)——服务于本浏览器半侧的宿主半侧。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
