---
description: "持久会话存储、历史日志编解码、投影和标题状态。"
kind: "package-group"
---

# session/ — 持久会话数据平面

[English](README.md) | 中文

## 概述

session 组保留持久历史、已发布日志格式的编解码、数据投影和基于日志的标题状态。各包定义持久化与迁移约定。独立历史查询位于 session-query 组。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

本组分为四个家族：持久存储（持久化 seam、后端、检查点策略）、投影、标题与遥测。每个包 README 负责各自的约定与配置。

### 持久化

| 包 | 职责 | ctx key |
|---|---|---|
| [`session-format/`](session-format/README.zh.md) | 纯相邻格式链与产物校验库 | 库，不使用 ctx key |
| [`session-format-v0-to-v1/`](session-format-v0-to-v1/README.zh.md) | 冻结的 released-v0 解码器，以及到 released v1 的恒等迁移 | 库，不使用 ctx key |
| [`session-format-v1-to-v2/`](session-format-v1-to-v2/README.zh.md) | 冻结的 released-v1 解码器，以及迁移到 released v2 时会改变基数的 Assistant 流迁移 | 库，不使用 ctx key |
| [`session-format-v2-to-v3/`](session-format-v2-to-v3/README.zh.md) | 冻结的 V2 解码器，以及迁入 V3 的系统提示词、信封与 PTC 转换 | 库——无 ctx 键 |
| [`session-format-v3-to-v4/`](session-format-v3-to-v4/README.zh.md) | V3 恒等迁移与 V4 编解码器，按 generation 校验 delivery | 库——无 ctx 键 |
| [`session-format-catalog/`](session-format-catalog/README.zh.md) | 自动生成的已交付相邻迁移静态目录 | 库，不使用 ctx key |
| [`session-persistence/`](session-persistence/README.zh.md) | 定义持久会话存储服务，以及每个后端组合的共享写入协调机制 | `ctx.sessionPersistence` |
| [`session-persistence-jsonl/`](session-persistence-jsonl/README.zh.md) | 随产品交付的后端：逐 Session 使用不可变规范 generation 文件名并排他发布后继；可选 Zstandard 压缩 | 注册到 `ctx.sessionPersistence` |
| [`session-log-deepseek/`](session-log-deepseek/README.zh.md) | 把增量规范日志作为可选的官方 DeepSeek 请求元数据上传 | 贡献 `dsh_session_log` |

### 投影

| 包 | 职责 | ctx key |
|---|---|---|
| [`session-projection/`](session-projection/README.zh.md) | 定义并驱动把已提交事件折叠为完整当前值的投影单元 | `ctx.sessionProjections` |
| [`working-directory/`](working-directory/README.zh.md) | 拥有每个 Session 的有效执行目录和用户上下文变更 | `ctx.workingDirectory` |
| [`tool-working-directory/`](tool-working-directory/README.zh.md) | 通过一个工具读取或改变当前目录 | `working_directory` |
| [`session-projection-cache/`](session-projection-cache/README.zh.md) | 持久化投影检查点，使冷读跳过全量日志加载 | `ctx.sessionProjectionCache` |
| [`session-stats/`](session-stats/README.zh.md) | 通过 `sessionStats` 单元提供全日志会话计数与墙钟时间 | 注册到 `ctx.sessionProjections` |
| [`session-turn-outline/`](session-turn-outline/README.zh.md) | 通过 `turnOutline` 单元提供全日志轮次大纲（轮次、`turn/start` seq、提示词预览） | 注册到 `ctx.sessionProjections` |

### 标题

| 包 | 职责 | ctx key |
|---|---|---|
| [`session-title/`](session-title/README.zh.md) | 基于日志的会话标题，带确定性回退与一个可选提供方 | `ctx.sessionTitle` |

### 遥测

| 包 | 职责 | ctx key |
|---|---|---|

同一时间只允许一个标题提供方注册；未注册时，标题服务保留其确定性回退。下面的子系统页面是各家族后端无关的参考资料。

-----

<a id="dev-note"></a>
## 开发备注

无。
