---
description: "HTTP 服务、前端分发与插件清单。"
kind: "package-group"
---

# host/ — Web GUI 宿主侧

[English](README.md) | 中文

## 概述

host 组保留 HTTP(S) 服务、构建后的前端分发与只读插件清单。YouDub 显式选择 Host 服务；原生文件对话框由 Desktop preload 桥提供。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

各包分别承担 Host 角色；各包的 README 拥有自己的约定与配置。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`webserver/`](webserver/README.zh.md) | 浏览器 HTTP 服务器：具名路由、upgrade、index 转换与回退席位 | `ctx.webServer` |
| [`frontend-static/`](frontend-static/README.zh.md) | 占据 webserver 回退席位的 SPA dist 服务器 | 消费 `ctx.webServer` |
| [`directory-picker/`](directory-picker/README.zh.md) | 工作区目录选择 seam：能力约定与错误词汇 | `ctx.directoryPicker` |
| [`plugin-inventory/`](plugin-inventory/README.zh.md) | 当前 Loader 条目的只读投影 | Remote `pluginInventory/list` |
| [`product-telemetry-otel/`](product-telemetry-otel/README.zh.md) | 通过 OTLP/HTTP 显式上报产品使用事件 | `ctx.productTelemetry` |

-----

<a id="related-documentation"></a>
## 相关文档

先从传输与工作区记录的子系统参考读起，再看 Web Client 背后的分层决策。

- [Web 配置树启动与传输分层](../boot/app-boot/README.zh.md)——Web 传输各层的所有权。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
