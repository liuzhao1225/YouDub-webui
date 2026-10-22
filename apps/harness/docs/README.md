# YouDub Desktop 开发文档

适用分支：`codex/harness-youdub-integration`。本文档描述以 DeepSeek Harness（DSH）源码为基础的 Electron 开发版。架构核对基于提交 `0cbfb696`；后续代码变化时需同步更新对应说明。

## 阅读顺序

| 文档 | 解决的问题 |
| --- | --- |
| [YouDub Desktop 改造计划](YOUDUB-DESKTOP-REFACTOR-PLAN.md) | 前期调研、Harness 自有分支、产品解耦、源码裁剪、私有运行资源及分阶段验收 |
| [架构说明](ARCHITECTURE.md) | DSH 提供哪些基础能力，YouDub 保留哪些业务代码，桌面、Host 和 Renderer 如何连接 |
| [本地开发](DEVELOPMENT.md) | 从源码准备框架与 runtime、启动桌面、修改后重建、隔离数据、排查启动错误 |
| [前端开发](FRONTEND-DEVELOPMENT.md) | 业务组件、官方控件、Slots、Store、请求、主题和语言的接入方式 |
| [后端与工作流开发](BACKEND-DEVELOPMENT.md) | 官方服务与领域服务的边界，节点、Python worker、模型和扩展的开发路径 |
| [多语言维护](LOCALIZATION.md) | 添加界面语言、注册框架字典、校验键和参数 |

按文件定位现有实现，使用[前端映射](../FRONTEND-MAPPING.md)和[功能覆盖账本](FUSION-COVERAGE.md)。按证据核对已验证范围，使用[代码复核](CODE-AUDIT.md)和[运行验证记录](validation.md)。它们分别记录实现位置与实际验收结果。

## 开发约束

- 2026-10-22 起允许修改 Harness 活动源码，用于 YouDub 产品解耦与裁剪；原始归档、来源清单和 YouDub 初始快照继续保持不变。实施顺序见[改造计划](YOUDUB-DESKTOP-REFACTOR-PLAN.md)，进展与缺口见[调研记录](REFACTOR-RESEARCH.md)。既有验收文档中的“上游原样”描述对应当时的候选提交。
- 通用能力使用 DSH 的公开服务、组件和插槽；YouDub 业务组件和媒体算法直接复用现有源码。新增业务沿现有节点、端口和状态合同扩展。
- 桌面开发入口为根目录 `npm start`；`build:desktop` 与 `build:youdub` 使用同一 Electron 开发构建。`apps/web` 的独立 React/Vite 入口与旧 Host 仍待迁移测试后清理；Swift/C# 旧壳和发行脚本已移除，`apps/desktop` 仅保留复用的图标与说明。
- 当前阶段使用源码开发构建，安装包、更新源及在线插件市场的状态见[代码复核中的剩余验收项](CODE-AUDIT.md#尚未通过的完整产品验收)。

固定源码版本、原 YouDub 快照和恢复方法见[来源基线](../baselines/README.md)。当前开发分支已包含旧 workflow、Harness 前端和字幕原型的历史；源码基线可通过标签 `youdub-source-baseline-20261021` 与 `youdub-harness-poc-baseline-20261021` 定位。
