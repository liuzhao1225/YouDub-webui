# YouDub 业务组件与测试

本目录保留 YouDub 页面、动态 Logo、动画、画布、校对组件和领域测试。桌面由 Harness Renderer、ModuleLoader、Slots、Store 和共享 React 承载；控件与服务接线位于 `apps/harness/src/frontend`。

产品构建使用根目录 `npm run build:youdub`，Electron 启动使用 `npm start`。`npm run dev:web` 启动同一 Harness Host 的浏览器开发入口。原独立 Vite 页面、浏览器 Context 引导和插件 import-map 构建已移除。

- `src/plugin/builtin/`：工作台、任务库、工作流、画布和任务校对组件。
- `src/components/`：业务组件；通用控件在产品构建中接入 Harness 实现。
- `src/locales/`：中文、英文、日语业务文案。
- `src/plugin/sdk.tsx`、`loader.ts`：保留组件及领域测试使用的合同，产品接入由 Harness 侧负责。

在本目录执行 `npm test`、`npm run typecheck` 和 `npm run lint`。修改当前产品请阅读[前端开发说明](../harness/docs/FRONTEND-DEVELOPMENT.md)与[本地运行](../harness/docs/DEVELOPMENT.md)。
