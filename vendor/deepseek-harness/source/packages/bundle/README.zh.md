---
description: "由产品自有 profile 组合启用的共享 Web 运行时。"
kind: "package-group"
---

# bundle/：Web 运行时

[English](README.md) | 中文

## 概述

本组保留共享 Web 服务与启动运行时。YouDub 在本目录之外声明 profile 组合；旧 base 和 headless 产品组合包已退役。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`web-app`](web-app/README.zh.md) | Web 服务与启动运行时 | `webRuntime`、`webStartup` |

产品与第三方组合包由保留的 profile 启动库和 PluginManager 解析。本运行时不贡献产品组合 patch。

<a id="related-documentation"></a>
## 相关文档

- [Profile 启动库](../../apps/cli/README.zh.md)——启动显式指定的 profile。
- [app-boot](../boot/app-boot/README.zh.md)——profile 如何解析、分层与定制。

<a id="dev-note"></a>
## 开发备注

无。
