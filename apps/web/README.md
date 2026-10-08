# YouDub Client

Next.js 提供根布局、静态资源和可选 catch-all 页面。业务界面由 Cordis Client 插件通过公共 slots 注册。

- `src/plugin/bootstrap.tsx`：创建浏览器 Context，按服务端 manifest 加载原生 ESM 插件。
- `src/plugin/sdk.tsx`：公开的 Client slots、导航和 React hooks。
- `src/plugin/builtin/`：登录、外壳、工作台、任务库、设置与本地化配置编辑器。
- `scripts/build-plugins.mjs`：构建官方 Client 插件与 React/Cordis 共享实例桥接。

在此目录运行 `npm test`、`npm run lint`、`npx tsc --noEmit`。`npm run dev` 和 `npm run build` 会先构建官方 Client 插件。

安装扩展、启动完整服务和运行环境配置见[项目说明](../../README.md)。
