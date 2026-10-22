---
description: "实验组地图：可公开安装的预稳定原型。"
kind: "package-group"
---

# packages/experimental

[English](README.md) | 中文

## 概述

实验性能力可按需安装和组合，但不提供产品支持承诺。包命名和发布遵循[实验包策略](../../scripts/experimental-package-policy.ts)。[可选组合规则](../../.agents/notes/implemented/architecture/2026-09-21-experimental-capabilities-as-optional-bundles.md)决定哪些能力以默认关闭状态随安装提供，并在 GUI 插件管理器的官方分组显式启用。

## 目录

- [实验性、可选与官方](#status)
- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="status"></a>
## 实验性、可选与官方

**实验性**表示整个公开能力仍在评估中，不属于产品支持承诺。其行为或 API 可能变更，能力也可能被撤回；工程、安全、文档、测试和已发布数据的义务仍然适用。只有其完整公开约定均为实验性或仅限内部使用的包才属于本组；产品包中的实验选项仍归原产品职责所有。

**可选**表示用户显式选择该能力。**官方**表示项目维护并在插件页列出该包。两者均不表示成熟度；发布、默认安装和界面可见性也不决定成熟度。组外产品包承担维护职责，其公开 API 仍遵循仓库的预稳定政策。

晋升需要明确的产品职责、公开行为与限制、当前消费者、发布内容以及测试证据。晋升时将包移入对应产品组，应用该组的命名规则，并同时更新受影响的消费者。[子树规则](AGENTS.md)规定依赖隔离和发布要求。

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`tool-session-query`](tool-session-query/README.zh.md) | 按工作区授权的模型会话搜索、追踪与事件读取 | — |
| [`tool-terminal`](tool-terminal/README.zh.md) | 持久终端工具 | — |
| [`translator`](translator/README.zh.md) | 免登录 Google 与 Bing 文本翻译 | `ctx.translator` |
| [`speech-to-text`](speech-to-text/README.zh.md) | 具名语音识别 Provider | `ctx.speechToText` |

-----

<a id="related-documentation"></a>
## 相关文档

- [实验包发布说明](../../scripts/experimental-package-policy.ts)——默认公开与私有例外。
- [工作树](../../docs/subsystems/worktrees.md)——显式创建分支与检出目录。
- [计算机操作](../../docs/subsystems/computer-use.md)——桌面提供方选择。
- [浏览器操作](../../docs/subsystems/browser-use.md)——浏览器提供方选择与 Session 所有权。
- [Agent Teams 子系统](../../docs/subsystems/agent-team.md)——持久 Team 类型与 `ctx.agentTeams` 服务 API。
- [实验子树规则](AGENTS.md)——实验状态放宽了什么、不放宽什么。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
