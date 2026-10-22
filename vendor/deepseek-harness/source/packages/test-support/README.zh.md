---
description: "确定性的框架与浏览器测试支持。"
kind: "package-group"
---

# packages/test-support

[English](README.md) | 中文

## 概述

test-support 组保留共享框架测试使用的 Loader、AgentLoop、浏览器插槽、Remote 和模拟提供商辅助实现。这些辅助实现不进入默认产品组合。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`agent-loop-testkit`](agent-loop-testkit/README.zh.md) | 为运行具体 AgentLoop 的测试提供共享先决服务 |
| [`client-runtime`](client-runtime/README.zh.md) | 为浏览器功能测试提供 jsdom slot 测试台 |
| [`remote-mock`](remote-mock/README.zh.md) | 为整体客户端测试提供端点具名的 Typert Remote mock 与它们安装的 Connection 载体面 |
| [`loader-smoke`](loader-smoke/README.zh.md) | 启动由 Loader 组合的应用并驱动 fixture（测试前置数据）轮次以执行冒烟测试 |
| [`llm-mock-server`](llm-mock-server/README.zh.md) | 为恢复测试提供可通过脚本控制的 OpenAI 兼容故障服务器 |

-----

<a id="related-documentation"></a>
## 相关文档

- [包组](../README.zh.md)——支持组与产品组的关系。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
