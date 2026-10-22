# 界面语言

YouDub Harness 版在「设置 → 通用 → 语言」中选择界面语言，直接使用 Harness 的 LanguageRow、locale 和 configForms 服务。侧边栏不再放固定的三语言按钮。界面语言与识别、翻译、配音的目标语言分别配置。

## 文案来源

- `apps/web/src/locales/{en,zh,ja}.json`：YouDub 业务文案，按稳定键管理；`id` 是语言代码，`label` 是语言自称。
- `apps/web/src/locales/index.ts`：内置语言目录和类型。组件通过 `useText()` 按键取文案，动态内容使用 `{parameter}`，不要在组件中按中英日位置排列字符串。
- `apps/harness/locales/ja.json`：官方设置、模型、主题、插件管理和通用操作的日语字典，按 Harness 原有 namespace/key 注册。官方中文和英文继续使用上游字典。
- `apps/harness/src/frontend/locales.ts`：通过官方 `locale.register` 和 `locale.addLanguage` 注册字典及语言。
- `apps/harness/src/frontend/i18n.tsx`：业务组件订阅官方语言状态，用 `locale.bind('youdub')` 翻译；偏好由 Harness Host 持久化。浏览器开发入口使用同一 Harness 服务；原独立 Web 启动入口已退役。

用户输入的任务名、工作流名、提供商名称和历史结果保留原文。内置工作流的展示名称按界面语言翻译，原始工作流文档保持不变。业务节点的名称、端口和参数继续使用现有 `LocalizedText` 契约，其 `default` 是缺失翻译时的显示文本。

## 添加内置语言

1. 在 `apps/web/src/locales/` 新增语言 JSON，提供与英文相同的键和参数，使用该语言自己的名称作为 `label`。
2. 将语言包加入 `languagePacks`；在 `apps/harness/locales/` 补齐该语言的框架字典，并加入 `frameworkDictionaries`。
3. 为需要显示的业务节点和端口补充 `LocalizedText.translations[语言代码]`。插件自有文案由插件维护，不能重写其他插件拥有的字典。
4. 运行 `npm --prefix apps/harness run check:locales`、相关界面测试和 `npm --prefix apps/harness test`。产品构建也会检查语言包的键、插值参数和官方字典覆盖，缺失时构建失败。
5. 在真实 Host 页面检查设置、模型编辑、插件管理、工作台和工作流；切换语言后刷新，并重启桌面应用确认保留。检查长文本布局和键盘操作。

扩展语言包可直接使用 Harness 的公开语言注册接口。官方设置自动列出已注册语言，支持其 fallback 规则，无需增加侧边栏按钮或修改上游源码。内置语言必须通过完整覆盖检查；外部扩展是否完成翻译由扩展维护者负责。

日语官方设置和模型字段沿用了原 YouDub 已有翻译，并补齐当前 Harness 字典新增字段。测试包含临时第四语言的注册、显示和回退验证；当前发行源码提供中文、English、日本語。

2026-10-23，55621d17 在隔离实际 Host 中安装临时第四语言插件，官方设置自动增加选项；切换、刷新和 Host 重启读回通过。卸载后选项消失并按官方规则回退英文，随后恢复测试 profile 原日语偏好。包只翻译一条文案，其余键验证英文回退；未新增产品内置语言。[操作与截图](evidence/refactor-fourth-locale.json)
