# YouDub Desktop 发行状态

当前 `codex/harness-youdub-integration` 分支处于源码开发阶段，没有安装包、签名、上传或版本 tag 发行流程。`npm run build:desktop` 与 `npm run build:youdub` 生成相同的 Electron 开发产物。

开发安装、构建和启动见[本地开发](../apps/harness/docs/DEVELOPMENT.md)；源码、框架和业务检查由 [harness-development.yml](../.github/workflows/harness-development.yml) 执行。当前平台和业务验收缺口见[改造计划](../apps/harness/docs/YOUDUB-DESKTOP-REFACTOR-PLAN.md)。

原 Swift/C# 壳的发布说明、版本校验及签名流程可在[裁剪前提交](https://github.com/liuzhao1225/YouDub-webui/blob/711e40e8e69d2c6f2065f15aecc90550dcbf695d/docs/releasing.md)读取。此次仅清理开发分支，保留 `main`、`atomgit` 和现有 Release。官网的版本列表生成脚本及下载链接测试继续保留。

Electron 安装、更新与发行需要在用户恢复此范围后单独实施和验收，不能沿用旧壳的安装测试作为证明。
