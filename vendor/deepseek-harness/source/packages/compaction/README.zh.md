---
description: "共享上下文压缩约定与策略。"
kind: "package-group"
---

# compaction/ — 压缩能力家族

[English](README.md) | 中文

## 概述

compaction 组保留框架组合与测试使用的摘要、上下文压力和工具输出策略，不额外装配产品功能。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

以下每个包提供该功能的一个环节；打开对应包页面了解如何使用。

| 包 | 职责 | ctx key |
|---|---|---|
| [`compaction/`](compaction/README.zh.md) | 共享的压缩约定：所有后端与触发器使用的操作与摘要格式 | `ctx.compaction` |
| [`compaction-basic/`](compaction-basic/README.zh.md) | 随 token 压力上升自动把较早历史压缩为摘要 | 注册 `ctx.compaction` |
| [`compaction-tool-result-pruner/`](compaction-tool-result-pruner/README.zh.md) | 修剪超大工具输出，减少需要压缩的历史 | `ctx.toolResultPruner` |
| [`compaction-image-offload/`](compaction-image-offload/README.zh.md) | 支持图片的路由拒绝请求时，把超出预算的请求图片替换为占位文本 | 监听 `agent/request-error` |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考了解共享词汇，再阅读两份 Agent Note 了解设计依据。

- [排队手动压缩 参考](compaction/README.zh.md)——按需 `/compact` 如何与运行中的轮次串行化。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
