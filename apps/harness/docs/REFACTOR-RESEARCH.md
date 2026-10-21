# YouDub Desktop 改造调研记录

日期：2026-10-22。分支 `codex/harness-youdub-integration`。目标与完整验收项见[计划](YOUDUB-DESKTOP-REFACTOR-PLAN.md)。本文记录已查到的证据和仍需验证的事项。

## 来源与可恢复基线

- 改造前产品提交：`4b9dc0a7168135f191dd4050a6d1d9a32d9e14b9`，新增非发行标签 `youdub-desktop-refactor-base-20261022`。
- 计划提交：`07d5d264468326d1d76eff1ae81dcef394525fe5`。
- Harness 原始公开源码：`687f282e8625c6b8d11ff58211a90524be2e4317`。选入 362 包、9,817 文件，原树 SHA-256 `3ea8bedf096c4fff74379dce01d95b48b27b2a05f9c0ae7431f3e9ba6fa80c85`。
- `verify.mjs --scope sources` 通过：10 项归档摘要、两份 Harness Git bundle/树、原 Harness checkout、YouDub 初始快照与 bundle。原源码工作区无改动。
- `vendor.mjs --verify-archive` 通过：校验原 tar.gz 后在独立临时目录解开，9,817 个选入文件的字节、执行位、链接均匹配原始清单。临时目录检查后释放，归档未改。
- 固定清单 [source-manifest.json](../../../vendor/deepseek-harness/source-manifest.json) 文件哈希为 `b9c6cf9bd5f0b69affcdf2ffc6bb45f63309efb6abdfd552031093f2dee6d42c`；活动差异保存在 [fork.json](../../../vendor/deepseek-harness/fork.json)，当前尚无上游业务源码变化。

## 前期调查进展

| 项 | 当前发现与第一批修改依据 | 未完成部分 |
| --- | --- | --- |
| R1 依赖闭包 | 模型设置仅在 DeepSeek 账号分支读取 `remote.session.modelCatalog`；其余模型 CRUD 使用 LLM/Settings/Credentials。桌面退出检查直接要求 agents/jobs | 逐项解除后核对新运行 inventory 和生成类型；不据静态发现批量删包 |
| R2 运行与构建范围 | profile 使用 base/web-app/YouDub 三层，117 个禁用覆盖；框架构建仍覆盖 362 包，客户端收据 325 产物 | 最小正向组合与剩余服务消费者清单 |
| R3 恢复/来源 | 归档恢复和初始状态检查通过，已建立产品改造前标签；原 Desktop 内嵌提交与公开 tag 的差异继续保留 | 首次行为改动后验证差异账本和产物来源 |
| R4 运行资源 | 启动器和开发项目读取 primary-runtime 的 Node/pnpm，Host 无条件安装 Office；profile 测试也误用了该 runtime 的 pnpm | 私有最小资源的来源、版本、哈希和跨平台准备流程；本批先让测试使用锁定的开发依赖 pnpm |
| R5 功能覆盖 | 冻结清单重新核对：58 路由、11 媒体操作、11 worker 操作、9 页面、50 组件文件；已有[功能账本](FUSION-COVERAGE.md) | 本次候选完整流程、B 站、音色等真实输入验收 |
| R6 界面 | 同一个 Electron Host 的浏览器入口可读，当前日语首屏保留 Logo/大标题，设置显示产品版本 0.0.7，模型页仅显示用户已配置提供商 | Mac 锁屏，原生窗口、保存框、画布与动效需解锁实测；截图只证明静态状态 |
| R7 数据/配置 | 启动器默认使用本工作区 `.cache/harness/desktop`，媒体、模型和缓存放在 YouDub 数据目录；已有凭据未改 | 环境回退、稳定 ID、迁移副本的完整复核 |
| R8 生命周期 | 领域人工等待与 Jobs 的运行状态职责不同；退出依赖 agents/jobs 会阻碍删除 Agent | 排队、远端等待、资源准备、未保存草稿的真实退出保护 |
| R9 扩展合同 | 现有三个 JS/Client/Python fixture 与官方 profile 安装回归可复用 | 新组合下安装、启用、执行、停用、卸载以及缺服务失败验收 |
| R10 CI/平台 | 旧 CI 会调用 Swift/C# 桌面打包；新增独立融合分支源码检查，不调用这些 workflow 或发行脚本 | 远端 CI、Windows 源码与实机验收；保留模块许可证裁剪核对 |

## 本批来源与构建实现

`framework-source.mjs` 检查原始清单哈希与精确 fork 差异；每项修改都须含原/新文件摘要及原因。原件校验继续独立进行。框架与 Desktop 构建使用当前 fork 输入，收据分别记录上游基准、fork 树哈希和产品提交。

staging 同步删除退役的源码输入，复制时不跟随目的端已有链接，并逐项检查字节/模式。`--verify-only` 不写收据。删除模块对应的编译产物仍由 P6 的全新目录裁剪验收兜清，不用输入同步推导产物已经裁净。

新 [源码 CI](../../../.github/workflows/harness-development.yml) 只针对融合分支，执行源码构建、领域/界面/Harness/Python 测试和语言检查，只上传构建证据。当前配置 macOS；Windows 仍在计划中，不能由该 job 代替。

## 已执行验证

| 检查 | 结果与范围 |
| --- | --- |
| 改造前 `npm --prefix apps/harness test` | 57 passed，0 failed，0 skipped；系统 Node 26.7.0。没有执行完整真实媒体链 |
| 来源规则针对性测试 | 4 passed：未经登记的增删改、原清单重写、缺原因、旧 staging、链接与执行位 |
| 本批 `npm --prefix apps/harness test` | 61 passed，0 failed，0 skipped；包括新增四项来源用例和 profile 使用开发依赖 pnpm 的回归 |
| 现有框架 `--verify-only` | 通过；检查时活动业务源码尚未改，未重写原有收据 |
| 全新 `.cache/harness/refactor-build-check` 构建 | pnpm 冻结安装 10.9 秒；原框架 7 个构建 gate 共 73.97 秒，全部通过；325 客户端产物。属于框架构建计时，未计入首轮复制与校验，不代表桌面冷启动性能 |
| 同 Host 页面观察 | `127.0.0.1:50031` 首屏、通用设置、模型页可用；只读观察，未改用户语言、凭据或任务 |
| 产品与来源检查 | `npm run build:youdub`、`check:composition`、Desktop 来源收据记录通过。仍为 42 Host/269 Client 活动模块；来源规则调整没有裁剪产品功能 |
| CI 文件与文档 | YAML 解析、融合分支触发、无旧发行命令、文档本地链接检查通过；尚未在 GitHub runner 执行 |

全新构建暴露依赖安装生成 `lefthook.yml` 示例文件的问题：Lefthook 的安装脚本需要 `CI=true` 才会跳过，单设 `LEFTHOOK=0` 不足。构建安装阶段已显式设 `CI=true`，清理本次生成的纯注释示例文件；重跑冻结安装通过，文件没有再次生成。未改变仓库 hooks 配置。

框架构建收据见 [全新构建记录](evidence/refactor-framework-clean-build.json)。完整临时日志为 `/tmp/youdub-refactor-framework-build.log`。原生交互、完整流程、启动性能、最终体积与 Windows 均保持待验收。
