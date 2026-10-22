---
description: "文件系统约定、提供方与文件工具。"
kind: "package-group"
---

# packages/fs

[English](README.md) | 中文

## 概述

fs 组保留文件系统服务、本地及沙箱实现、观察策略和基础文件工具。提供方所有权、取消及修改保护遵循各包的现有约定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

七个包承担文件系统角色；子系统参考文档完整收录各项约定与错误分类体系。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`fs/`](fs/README.zh.md) | `ctx.fs` 服务约定：执行世界路径、有界文本 I/O，以及带可选版本防护的原子变更 | `ctx.fs` |
| [`fs-local/`](fs-local/README.zh.md) | 宿主文件系统后端：读取、写入并编辑本机上的真实文件 | 注册到 `ctx.fs` |
| [`fs-sandbox/`](fs-sandbox/README.zh.md) | 沙箱强制后端：按每次调用的沙箱模式约束写入与编辑，读取直接通过 | 注册到 `ctx.fs` |
| [`fs-observation-policy/`](fs-observation-policy/README.zh.md) | 编辑前读取策略：记录观测到的存在或缺失，并通过 `fs/*` 事件防护写入/编辑 | `fs/*` 监听器 |
| [`tool-fs/`](tool-fs/README.zh.md) | 面向模型的 `read`、`read_image`、`write` 与 `edit` 工具及其执行器 | 注册到 `ctx.tools` |

策略是插件，不是工具注入的服务：移除它会留下裸提供方的无条件变更行为，而不会破坏工具。`fs-sandbox` 的模式围栏与编辑前读取门禁可以组合。`tool-fs-search` 有意不扩展提供方约定——搜索是由进程支持的 ripgrep 工作流，因此文件系统后端无需承担通用搜索 API。

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考文档了解共享词汇与错误分类体系，再看塑造该家族的设计决策。

- [跨能力族 fs 沙箱参考](../sandbox/sandbox-policy/README.zh.md)——文件系统 seam 上共享的沙箱模式围栏。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
