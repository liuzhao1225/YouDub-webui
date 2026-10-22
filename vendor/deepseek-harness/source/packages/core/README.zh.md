---
description: "供显式框架组合使用的会话、提示词、工具和 Agent 约定。"
kind: "package-group"
---

# packages/core

[English](README.md) | 中文

## 概述

core 组保留会话历史、系统提示词组装、工具注册和 Agent 约定。产品自己的 profile 按需选择服务；共享 Web 运行时位于 packages/bundle。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`scope/`](scope/README.zh.md) | 隔离单个 agent 贡献的作用域注册与事件路由 | 库，不使用 ctx key |
| [`session/`](session/README.zh.md) | 每个 agent 的历史均派生自该仅追加会话事件日志 | `ctx.sessions` |
| [`system-prompt/`](system-prompt/README.zh.md) | 由有序段、工具 schema 与变量进行的系统提示词组装 | `ctx.systemPrompt` |
| [`tools/`](tools/README.zh.md) | 供循环分发使用的工具注册表与带防护机制的执行流水线 | `ctx.tools` |
| [`agent/`](agent/README.zh.md) | 供插件编程使用的 `Agent` 句柄，以及其实时注册表与事件 | `ctx.agents` |
| [`agent-default-model/`](agent-default-model/README.zh.md) | 入口对全新 agent 应用的部署默认模型选择 | `ctx.agentDefaultModel` |
| [`agent-loop/`](agent-loop/README.zh.md) | 默认 agent 驱动器：创建 agent 并运行轮次与步骤生命周期 | `ctx.agentLoop` |

`scope` 提供共享作用域原语；`agent` 负责公开的 `Agent` 约定，而 `agent-loop` 是其默认实现，因此扩展插件依赖 `agent`，驱动器保持可替换。`agent-default-model` 负责入口在会话自身没有选择时应用的部署选择。可运行组合位于 [`packages/bundle`](../bundle/README.zh.md)；本分组只负责可替换的主干组件。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
