# YouDub 桌面资源

当前 Electron 产品入口位于 [`apps/harness`](../harness/docs/DEVELOPMENT.md)。本目录保留 [`icon.svg`](icon.svg)，由产品开发构建生成应用图标。

在仓库根目录执行：

```sh
npm run build:framework
npm run build:desktop
npm start
```

`build:desktop` 与 `build:youdub` 生成相同的 Electron 开发产物。当前阶段不制作安装包、不签名、不发布。

原 Swift/WKWebView 和 C#/WebView2 桌面壳、专属打包脚本与发行 CI 已从本分支移除，历史源码可在[裁剪前提交](https://github.com/liuzhao1225/YouDub-webui/tree/711e40e8e69d2c6f2065f15aecc90550dcbf695d/apps/desktop)读取；最初 YouDub 快照见[来源基线](../harness/baselines/README.md)。`main` 与 `atomgit` 未随本次清理修改。旧桌面验收记录只证明其记录的版本，当前 Electron 的平台验收见[改造计划](../harness/docs/YOUDUB-DESKTOP-REFACTOR-PLAN.md)。
