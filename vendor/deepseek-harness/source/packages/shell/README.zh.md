---
description: "Shell 执行约定与本地实现。"
kind: "package-group"
---

# shell/ — bash 能力家族

[English](README.md) | 中文

## 概述

shell 组保留命令执行约定、本地 Bash 与 PowerShell 执行器，以及共享环境解析。框架组合显式选择所需能力。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`shell`](shell/README.zh.md) | 定义执行器约定：前台运行、后台句柄与请求解析 | `ctx.shell` |
| [`bash-local`](bash-local/README.zh.md) | 在 POSIX 上以全新 `bash -c` 进程运行 Bash 命令 | 注册 `ctx.shell` |
| [`pwsh-local`](pwsh-local/README.zh.md) | 在 Windows 上以全新 `pwsh -Command` 进程运行 PowerShell 命令 | 注册 `ctx.shell` |
| [`shell-env`](shell-env/README.zh.md) | 提供每条 shell 命令都会收到的受管 `DSH_*` 环境 | `ctx.shellEnv` |
| [`tool-bash`](tool-bash/README.zh.md) | 以 `bash` 工具向模型公开 Bash 执行与后台任务 | 注册到 `ctx.tools` |


-----

<a id="dev-note"></a>
## 开发备注

无。
