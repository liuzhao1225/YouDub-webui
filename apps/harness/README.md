# YouDub Desktop

YouDub 使用保留的 Harness 桌面、Host 和 UI 源码；视频、字幕、配音及工作流由 YouDub 业务层实现。

## 开发

在仓库根安装根目录、`apps/harness` 与 `apps/web` 的 npm 依赖，然后运行：

```sh
npm run build:framework
npm run build:youdub
npm run dev
```

这三个命令构建并启动开发客户端。安装包由 `npm run package:desktop` 显式生成。

## 修改位置

| 内容 | 入口 |
| --- | --- |
| 窗口、系统菜单和 Host 生命周期 | [src/desktop-product.ts](src/desktop-product.ts) |
| 自动检查更新与官网发版 | [更新链路](docs/UPDATES.md)、[src/desktop-updates.ts](src/desktop-updates.ts) |
| 业务服务、Python 与媒体工作流 | [src/host.mjs](src/host.mjs) |
| 导航、页面与共享 UI | [src/client.jsx](src/client.jsx) |
| 产品插件装配 | [cordis.patch.yml](cordis.patch.yml) |
| 框架来源与保留范围 | [源码说明](../../vendor/deepseek-harness/README.md)、[包范围](docs/FRAMEWORK-SCOPE.md) |
| 构建输入与产物缓存 | [framework-source.mjs](framework-source.mjs)、[build-framework.mjs](build-framework.mjs) |

`check:composition` 检查业务 bundle 的装配边界；`npm --prefix apps/harness test` 验证 Host、首启、资源与产品合同。测试运行读取当前框架源码构建，缺失或过期时明确报错。

框架代码发生改变时，完成一批修改后统一构建和验证。涉及可见界面或桌面行为，再用实际客户端核对。资源就绪、真实媒体处理、安装包和公开发行分别验收。

更多内容见[开发文档](docs/README.md)。
