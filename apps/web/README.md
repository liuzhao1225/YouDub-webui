# YouDub Client

React 19 与 Vite 提供客户端薄壳；生产环境由 Cordis Host 同源提供页面、静态资源和 API，页面深链接返回 SPA 入口。业务界面由 Cordis Client 插件通过公共 slots 注册。

- `src/plugin/bootstrap.tsx`：创建浏览器 Context，按服务端 manifest 加载原生 ESM 插件。
- `src/main.tsx`：React 根与首次准备入口。
- `src/plugin/sdk.tsx`：公开的 Client slots、导航和 React 绑定。
- `src/plugin/builtin/`：会话、外壳、工作台、任务库、工作流、设置与旧任务配置编辑器。
- `src/plugin/web-react.tsx`：将 React-free runtime 快照与服务绑定到页面。
- `scripts/build-plugins.mjs`：构建官方 Client 插件与 React/Cordis 共享实例桥接。

在此目录运行 `npm test`、`npm run lint`、`npx tsc --noEmit`。`npm run dev` 和 `npm run build` 会先构建官方 Client 插件。

安装扩展、启动完整服务和运行环境配置见[项目说明](../../README.md)。
