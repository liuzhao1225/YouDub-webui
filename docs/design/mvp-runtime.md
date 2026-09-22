# MVP 开发分支运行说明

本页记录 `codex/mvp-mainline` 当前已实现的行为。总体接口见[主干设计](youdub-desktop-v0.1.md)，实施顺序见[开发计划](mvp-development-plan.md)。

## 当前实现

- `/api/health` 返回 `status` 和本次进程的 `instance_id`。它表示后端可响应请求；模型能力查看 `/api/v1/runtime`。
- `/api/v1/runtime` 返回 CPU/CUDA 设备、能力目录和输入限制。当前 v1 媒体执行链尚未接入，四个适配器明确显示不可用。
- `GET /api/v1/settings` 读取默认配置、界面语言和脱敏连接；`PATCH` 每次更新一个配置组。
- 登录和 CSRF 沿用现有机制。v1 的认证、参数、存储和凭据错误使用 `error.code/message/field/stage/action`。
- Task、配置、产物与步骤结果的数据结构已经定义；任务接口和执行链在后续阶段接入。

## 本地运行

沿用仓库 [README](../../README.md) 的环境配置和启动方式，更新依赖后运行 `npm run dev:api`。应用读取 `.env`；新增 `keyring>=25.6,<26` 依赖，用于[系统凭据存储](https://keyring.readthedocs.io/en/latest/)。

MVP 业务数据使用新目录中的 `desktop.sqlite`，保留旧 WebUI 数据库的原有语义。可以通过 `YOUDUB_DESKTOP_DATA_DIR` 指定独立目录；默认位置如下：

| 平台 | 默认目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%/YouDub` |
| macOS | `~/Library/Application Support/YouDub` |
| Linux | `$XDG_DATA_HOME/youdub`，未设置时为 `~/.local/share/youdub` |

新库只含 `tasks`、`settings` 两张业务表。旧认证机制继续使用现有认证存储；下一阶段统一执行入口时继续核对数据目录与认证边界。

## 设置与密钥

在现有界面登录后，业务请求使用同一会话 Cookie。写请求携带登录或 session 接口返回的 `X-CSRF-Token`。

例如更新界面语言：

```http
PATCH /api/v1/settings
Content-Type: application/json
X-CSRF-Token: <session csrf token>

{"ui_language":"zh"}
```

连接按适配器单独设置，目前可配置远端翻译适配器 `openai`。`api_key` 省略表示保留，非空值表示替换，`null` 表示清除。更换 `base_url` 时不会将旧地址的密钥发到新地址。

密钥仅写入系统凭据库；SQLite 保存引用，GET 返回 `has_api_key`。任务保存的凭据引用由任务持有；轮换默认连接时清理未被任务引用的旧凭据。系统凭据库不可用时明确失败。密钥操作和 SQLite 写入发生部分提交时返回 `SETTINGS_PARTIALLY_APPLIED`，需要读取设置核对实际状态。

## 已验证与待完成

2026-09-22：契约、Runtime、Settings 及相关旧认证/API 回归通过；macOS 系统凭据库的实际写入、读取、删除通过。凭据验证使用临时测试值，验证后已删除。

当前尚未完成 v1 视频上传、Task 执行、前端切换、真实模型三模式验收及 Windows 实机验收。Runtime 的输入限制是后续导入和执行链需要实际执行的准入限制。
