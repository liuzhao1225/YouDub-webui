# MVP 开发分支运行说明

本页记录 `codex/mvp-mainline` 当前已实现的行为。总体接口见[主干设计](youdub-desktop-v0.1.md)，实施顺序见[开发计划](mvp-development-plan.md)。

## 当前实现

- `/api/health` 返回 `status` 和本次进程的 `instance_id`。它表示后端可响应请求；模型能力查看 `/api/v1/runtime`。
- `/api/v1/runtime` 返回 CPU/CUDA 设备、能力目录和输入限制。当前 v1 媒体执行链尚未接入，四个适配器明确显示不可用。
- `GET /api/v1/settings` 读取默认配置、界面语言和脱敏连接；`PATCH` 每次更新一个配置组。
- 登录和 CSRF 沿用现有机制。v1 的认证、参数、存储和凭据错误使用 `error.code/message/field/stage/action`。
- Task 上传、配置与连接快照、列表/详情、日志，以及产物 GET/HEAD/Range 已接入。浏览器按 UUID 提交视频和 JSON 配置；失败导入保留同 ID 残留，可通过删除接口清理。
- v1 与原 WebUI 共用单线程 worker。一个 Task 持续占用执行位置，远端 waiting 保留查询 ID；重启时中断的本地步骤明确失败，已保存的远端等待继续查询。
- `prepare` 已使用 FFprobe 检查媒体限制、FFmpeg 提取 16 kHz 单声道音频，原视频保留。ASR、翻译、配音、混音和导出仍待接入；测试适配器只存在于测试文件，Runtime 继续明确显示不可用。
- cancel、retry、rerun、delete 已接入：取消确认本机进程退出；retry 保留原配置及连接快照，attempt 加一并从 prepare 开始；rerun 复制原视频并使用新配置；delete 拒绝活动任务、进行中的文件写入和下载。

## 本地运行

沿用仓库 [README](../../README.md) 的环境配置和启动方式，更新依赖后运行 `npm run dev:api`。应用读取 `.env`；新增 `keyring>=25.6,<26` 依赖，用于[系统凭据存储](https://keyring.readthedocs.io/en/latest/)。

MVP 业务数据使用新目录中的 `desktop.sqlite`，保留旧 WebUI 数据库的原有语义。可以通过 `YOUDUB_DESKTOP_DATA_DIR` 指定独立目录；默认位置如下：

| 平台 | 默认目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%/YouDub` |
| macOS | `~/Library/Application Support/YouDub` |
| Linux | `$XDG_DATA_HOME/youdub`，未设置时为 `~/.local/share/youdub` |

新库只含 `tasks`、`settings` 两张业务表。旧认证机制继续使用现有认证存储；两套任务入口共用执行器，v1 文件保存在新数据目录下的 `tasks/<UUID>/input|work|output`。

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

任务链已用真实合成视频和显式测试适配器验证上传、顺序执行、远端等待、错误、产物注册及文件下载；测试中的 ASR、翻译、导出结果不代表真实模型效果。媒体准备单独验证了真实 FFmpeg 输出和原视频未改写。

动作接口验证包含重试幂等、复制输入、文件失败保留记录、下载期间拒绝删除，以及真实子进程取消后退出。远端 waiting 的取消只保证本机停止；已接受的远端请求遇到结果校验错误时仍保留 ID 和 unknown 风险，禁止直接 retry，rerun 需要 `acknowledge_external_risk=true`。

当前尚未完成前端切换、真实模型三模式验收及 Windows 实机验收。Runtime 的输入限制分别在导入和 prepare 实施；实际模型链未接通前，公开接口会拒绝不可用的模型组合。
