---
description: "YouDub Desktop 保留的 Electron 框架服务。"
---

# YouDub 的 Desktop 框架

[English](README.md) | 中文

## 范围

YouDub 使用本包的 Electron 生命周期、profile 准备、Web 认证传输、私有 Node 模式 Host、IPC 校验、目录选择、快捷键、主题、崩溃诊断和沙箱应用 preload。产品主入口位于 [apps/harness/src/desktop-product.ts](../../../../../apps/harness/src/desktop-product.ts)。

旧 Harness 产品主入口、原生登录/欢迎页、Platform 账号视图和旧开发启动器已移除。原生语言读取通过 [desktop-settings.ts](src/desktop-settings.ts) 仅查询 Settings。Host IPC 不再接收账号凭据，应用 preload 不再暴露账号桥接。

## 开发

在 YouDub 仓库根目录运行 `npm run dev`。框架构建输出 `preload-app.cjs`；产品构建组合保留的 Desktop 模块，并按显式包闭包建立开发运行目录。本包没有独立应用入口或登录步骤。

本包仅保留源码开发构建命令。上游更新器、依赖账号的强制更新策略、命令安装器、打包/签名/上传脚本及专属资源已从活动 fork 移除，原件继续保存在归档中。原生 preload 不暴露更新安装桥接。通用快捷键覆盖窗口输入保护及其原有测试继续保留。

## 来源与检查

原始上游源码归档和清单继续保留。`vendor/deepseek-harness/fork.json` 记录活动源码变更。复制的原生窗口/菜单代码块按原始 `apps/desktop/src/main.ts` 提取的哈希校验，记录在 `apps/harness/baselines/native-blocks.json`。

开发 CI 检查原生设置传输、Host 退出及故障处理、profile 隔离、沙箱 preload 和保留的前端服务。真实原生文件框、窗口交互和完整媒体流程另行记录在[改造计划](../../../../../apps/harness/docs/YOUDUB-DESKTOP-REFACTOR-PLAN.md)。
