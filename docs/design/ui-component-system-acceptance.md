# 共享组件与视觉规范验收

2026-10-22

## 交付范围

- [Harness视觉与组件规范](harness-visual-spec.md)：几何、字阶、材质、动效、交互、基础组件契约、业务组合组件、配色映射与验收矩阵。
- [组件源码索引](component-inventory.md)：按实际TSX导出生成。
- 预览页由原始 Harness CSS 与 YouDub 主题生成。使用 `node scripts/build-ui-design-reference.mjs` 重建，当前输出位于 `output/ui-design-reference.html`；历史提交保留原验收页面。
- 输入、选择、开关、标签、提示、菜单、弹窗使用原始Harness组件或原始CSS；Surface、Disclosure、Progress作为业务组合共用。模型设置删除复制的CSS文件，直接引用原始设置样式。
- Web和桌面构建读取同一YouDub主题映射；Logo、红色主操作、粉蓝渐变与状态颜色保留。

## 自动验证

- TypeScript检查通过。
- 9个相关测试文件、90项测试通过，覆盖基础控件、模型设置、首次安装、任务、工作流、画布和设置。Node 26执行Vitest时使用`NODE_OPTIONS=--no-experimental-webstorage`，避免Node实验性localStorage覆盖jsdom。
- `git diff --check`通过。
- 本次客户端构建通过。构建使用已通过账本校验的Harness源码快照，SHA-256为`9c1f32690889be3ca60183350a1ce0bbaa130ed66ef3013c6484cd21f3bbcd23`。

## 实际界面

本地Harness Web承载地址：`http://127.0.0.1:51591/`。

- 工作台白色输入面、0.5px边线、12px角，无外部聚焦圈。
- 资源详情Enter展开/收起。修复details匿名内容盒导致的窄列问题；展开区域与父区域均为931px。
- 真实完成任务的步骤列表展开、语音识别结果、时间与字幕编辑字段。
- 任务详情四项分段控件使用Harness SegmentedControl；ArrowRight和Home切换，选中tab关联正确tabpanel。
- 浅色与深色校对界面、主题菜单、原始数据折叠。
- 临时编辑后离开触发共享未保存弹窗；焦点进入“继续编辑”，Escape关闭。已清除临时草稿，没有保存任务更改。
- 规范预览的浅深主题与组件表面。

截图：

- [浅色校对](../../output/validation/ui-system-v2-20261022/transcript-light.png)
- [深色校对](../../output/validation/ui-system-v2-20261022/transcript-dark.png)
- [未保存弹窗](../../output/validation/ui-system-v2-20261022/unsaved-dialog.png)
- [浅色规范](../../output/validation/ui-system-v2-20261022/reference-light.png)
- [深色规范](../../output/validation/ui-system-v2-20261022/reference-dark.png)

## 验证边界

当前工作区还有另一组未登记到fork账本的Harness测试文件改动，因此当前整个工作区的正式构建仍被源码校验阻断。本轮没有覆盖或登记这些并行改动；客户端验收采用上述已校验快照。没有重新打包或验收安装包冷启动。隔离环境未配置翻译服务，翻译编辑器由相关自动测试覆盖，本轮没有重新执行完整媒体工作流。
