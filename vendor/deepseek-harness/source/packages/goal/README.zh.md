---
description: "持久目标状态服务。"
kind: "package-group"
---

# packages/goal

[English](README.md) | 中文

## 概述

goal 组保留供框架使用方显式选择的持久目标状态服务。状态归所属会话管理，遵循现有持久化约定。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`goal`](goal/README.zh.md) | 每个会话一个持久目标：创建、编辑、暂停、恢复、完成、阻塞和清除 | `ctx.goals` |

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
