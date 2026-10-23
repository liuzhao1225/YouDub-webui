---
description: "存储组地图：通过具名后端与类型化领域数据形式持久化非会话数据，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/storage

[English](README.md) | 中文

## 概述

storage 组保留存储服务、JSON 后端，以及带 schema 校验和变更通知的领域记录。这些可选宿主库用于持久保存非会话应用数据，由使用方的组合选择后端。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`storage`](storage/README.zh.md) | 把已注册后端与已挂载的数据形式设施连接起来 | `ctx.storage` |
| [`storage-json`](storage-json/README.zh.md) | 把每个单元存为一个人类可读的 JSON 文件 | 注册后端 `json` |
| [`storage-domain`](storage-domain/README.zh.md) | 在已路由后端之上提供经过 schema 校验、发出变更事件的 KV 领域 | `ctx.storageDomain` |

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

设计 Agent Note 仍标记为 proposed，而本家族已经发布；其范围外事项表就是迁移阶段（`log` 分面、会话后端复用、跨进程变更推送）的延期工作清单。决策落地后，请把结论提升为 implemented 笔记。

</details>
