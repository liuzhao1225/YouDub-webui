---
description: "持久目标状态及显式使用的工具与命令。"
kind: "package-group"
---

# packages/goal

[English](README.md) | 中文

## 概述

goal 组保留持久目标状态、模型工具和用户命令，供显式 Agent 组合使用。每个会话保存一个当前目标。旧的自动轮次驱动已移除。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`goal`](goal/README.zh.md) | 每个会话一个持久目标：创建、编辑、暂停、恢复、完成、阻塞和清除 | `ctx.goals` |
| [`tool-goal`](tool-goal/README.zh.md) | 模型工具 `get_goal`、`create_goal`、`update_goal` | 注册到 `ctx.tools` |
| [`command-goal`](command-goal/README.zh.md) | UI 命令平面中的用户 `/goal` 命令 | 注册到 `ctx.commands` |

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
