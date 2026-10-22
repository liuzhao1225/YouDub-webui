---
description: "实时与持久会话历史的查询服务及实现。"
kind: "package-group"
---

# session-query/：会话检索能力家族

[English](README.md) | 中文

## 概述

session-query 组保留实时与持久会话的精确历史读取、筛选、关系追踪和全文搜索。SQLite 实现提供搜索索引。各包说明自己的查询约定与配置。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包的 README 都会说明该包在此组中的用途。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`session-query/`](session-query/README.zh.md) | 统一的会话历史查询服务：精确读取、关系追踪与过滤 | `ctx.sessionQuery` |
| [`session-query-sqlite/`](session-query-sqlite/README.zh.md) | 基于 SQLite FTS5 索引的会话历史全文搜索 | 注册到 `ctx.sessionQuery` |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考了解共享的查询词汇，再看追踪与搜索背后的设计记录。

默认 Web 和 Desktop 使用这套共享查询、索引与导出基础设施。[实验性面向模型工具](../experimental/tool-session-query/README.zh.md)是独立的可选消费方。


<a id="dev-note"></a>
## 开发备注

无。
