# YouDub 桌面资源

当前 Electron 产品入口位于 [`apps/harness`](../harness/docs/DEVELOPMENT.md)。本目录保留 [`icon.svg`](icon.svg)，由产品开发构建生成应用图标。

在仓库根目录执行：

```sh
npm run build:framework
npm run build:desktop
npm start
```

`build:desktop` 与 `build:youdub` 生成相同的 Electron 开发产物。安装包、签名和公证见[发行流程](../../docs/releasing.md)。

原 Swift/WKWebView 和 C#/WebView2 桌面壳已移除，历史源码见[裁剪前提交](https://github.com/liuzhao1225/YouDub-webui/tree/711e40e8e69d2c6f2065f15aecc90550dcbf695d/apps/desktop)。当前使用的框架子集见[保留范围](../harness/docs/FRAMEWORK-SCOPE.md)。
