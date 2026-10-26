# 文本合并与人工校对插件

使用 Harness 插件生命周期和 YouDub 节点协议，演示两个文本输入、合并校对、人工订正、确认后导出文本。

先在仓库根目录执行 `node fixtures/plugins/build.mjs`。在 YouDub「扩展」中添加本目录的绝对路径，确认插件已激活后运行「文本合并与人工校对」。任务会停在校对节点；修改文本、保存并确认后，可下载包含来源数量的文本文件。

- `src/domain.mjs`：节点与端口定义、模板、订正校验和导出实现。
- `src/host.mjs`：通过 `youdubContext` 将业务注册到当前 Host。
- `src/client.jsx`：通过官方 `youdub.workflow.node.details` 插槽提供校对输入框。

源码与插件安装回归共用这一份示例。旧加载器及其 HTTP 验收脚本保留在 `SOURCE.json` 指向的 Git 提交中；当前调用使用 Harness Connection。
