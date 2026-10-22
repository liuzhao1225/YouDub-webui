---
description: "运行时 API 检查，以及进程内的 Host 和 Client 执行服务。"
kind: "package-group"
---

# packages/extensions

[English](README.md) | 中文

## 概述

extensions 组保留运行时 API 检查及进程内的 Host、Client 执行服务。持久插件安装由 Plugin Manager 负责。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`tool-cordis`](tool-cordis/README.zh.md) | 两个只读运行时 API 发现工具 | 注册到 `ctx.tools` |
| [`cordis-host-runner`](cordis-host-runner/README.zh.md) | host 半：定义注册表、沙箱化的 host 半生命周期，以及用于应答浏览器查询的 inspect 注册表 | 提供 `ctx.dynamicCordisRunner` 与 `ctx.cordisInspect` |
| [`cordis-client-runner`](cordis-client-runner/README.zh.md) | 浏览器半：将浏览器半源码求值为运行中的插件，并应答运行请求 | client 面；提供浏览器侧 `ctx.dynamicCordisRunner` |

-----

<a id="related-documentation"></a>
## 相关文档

- [自引用 Cordis 工具集 参考](cordis-host-runner/README.zh.md)——沙箱语义、生命周期与组合的设计居所。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

两个浏览器半包位于本组，而不是 `packages/client/` 下，因为它们分别是本子系统双半包的浏览器半；client 面经由 client program 编译它们，host program 只引用 host runner。

</details>
