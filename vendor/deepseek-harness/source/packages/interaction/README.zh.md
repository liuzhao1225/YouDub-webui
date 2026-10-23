---
description: "命令、审批与问题交互约定。"
kind: "package-group"
---

# interaction/：人机协作平面

[English](README.md) | 中文

## 概述

interaction 组保留命令注册、审批、权限预设与用户问题服务。产品界面通过共享框架选择所需服务。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包的完整约定以其 README 和对应的子系统参考为准。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`commands/`](commands/README.zh.md) | 让用户输入斜杠命令，直接针对 agent 执行，无需模型往返 | `ctx.commands` |
| [`user-approval/`](user-approval/README.zh.md) | 向组合后的应答者征求一次性允许／拒绝决定；若未获得决定，则默认拒绝 | `ctx.approval` |
| [`permission-presets/`](permission-presets/README.zh.md) | 把沙箱模式与审批策略捆绑为一个面向用户的权限选择器 | `ctx.permissionPresets` |
| [`user-questions/`](user-questions/README.zh.md) | 定义经过校验的问题 schema 与作用域 answerer waterfall，agent 可暂停等待 | `ctx.userQuestions` |

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
