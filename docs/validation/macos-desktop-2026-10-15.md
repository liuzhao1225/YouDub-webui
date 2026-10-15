# macOS 桌面安装包验收

日期：2026-10-15。分支：`codex/mvp-mainline`，基础提交：`447206c9a2d0bf7a013ff7990cfec76d34271562`，包含本次本地桌面实现和修复。

目标：Apple Silicon，macOS 14 及以上。应用版本：0.1.0。首次交付构建号：20261015.5；图标更新构建号：20261015.6。

## 图标更新（构建 20261015.6）

- 当前透明横向标志的视觉重心偏上，两侧声波贴近图标画布边缘。桌面专用图标改为浅粉、淡紫至淡蓝的圆角渐变底板，保留原有红色播放气泡和粉蓝声波。
- 标志宽度为画布的 78%，外接框中心向下移动画布高度的 3.125%。底板内部不透明，圆角外保留系统图标所需的透明边距。
- 源文件：`apps/desktop/icon.svg`；构建脚本由该文件生成各尺寸 ICNS。网站内的标志和业务界面未修改。
- 使用 `npm run build:mac -- --reuse-web` 构建，签名后安装到 `/Applications/YouDub.app` 并实际进入工作台。环境和四个模型均为 `ready`，脱敏回读保存在 `.cache/mac/build6-startup.json`；运行及退出后的严格签名检查均通过。
- 从已安装应用的 ICNS 提取所有尺寸，核对渐变背景像素均不透明，并检查实际预览。新旧应用包的业务代码、前端内容一致，差异集中在图标、构建信息、编译产物、公证票据和签名。
- `notarytool` 的加速和普通 S3 上传均发生 `HTTPClientError.deadlineExceeded`，失败提交分别为 `6a8e906a-ba46-4e14-adcf-5ea9a7b5192b`、`0804903b-1c47-4f3c-91aa-2ebf9ef8da3e`。失败已显式报告，签名脚本恢复原钥匙串搜索列表并删除临时钥匙串。
- 保持同一个 DMG 文件（上传前 SHA-256：`a4305e53604019a44926715ae123e9f36a1d95b085535d3f6efcbe29a592683c`），按 [Apple 官方公证 API 流程](https://developer.apple.com/documentation/notaryapi/submitting-software-for-notarization-over-the-web)，通过本机现有代理上传。第一次 API 传输根据实测低速主动停止，以延长上传时限；最终传输返回 HTTP 200，完整上传 90,972,629 字节，耗时约 818 秒。
- Apple 公证通过：`Accepted`，最终提交编号 `b51d7e72-a748-4d28-a89a-68e8bc5315d3`。`dist/dmg-notary.json` 保存回执，`dist/dmg-notary-log.json` 中 `issues: null`。
- 最终 DMG、候选应用、`dist/YouDub.app` 和已安装应用均已附加公证票据；DMG 与已安装应用的票据校验和 Gatekeeper 检查通过。
- 最终 DMG 只读挂载后，内部应用构建号为 `20261015.6`，严格签名和 Gatekeeper 检查通过；其图标及签名资源清单与 `/Applications/YouDub.app` 完全一致。
- 附加公证票据后重新启动 `/Applications/YouDub.app`，原生独立窗口进入工作台，启动后的严格签名检查通过；应用保留打开。
- 最终交付：`dist/YouDub-0.1.0-macOS-arm64.dmg`；附加票据后的 SHA-256：`cc69a2b4fb2dbdaa4f773ccb59c6fedf0240e2eb9628d91154b35ed1833c1f9d`。

## 已验证行为

- AppKit 独立窗口内嵌 WKWebView，自动启动内置 Node 22.23.2、Cordis 和 Next.js，进入原工作台。
- 从 GUI 的最小 PATH 启动，自动准备数据目录下的 Python 3.12.15、依赖、FFmpeg/ffprobe 和分句资源；复用已下载的四个模型，共 6,967,662,269 字节。
- 修复 Whisper 通过命令名查找 FFmpeg 的失败：准备媒体工具后将其目录加入服务 PATH，实际模型可用性检查和工作台启动通过。
- 在隔离数据目录中设置不存在的 Python 路径，实际错误框右上角显示复制按钮；点击后变为“已复制”，原始错误保持可见。多行完整错误文本通过前端测试校验。
- 原生文件选择框可以打开和取消。按 ⌘Q 退出后，原生应用、桌面服务和 Python bridge 均已退出。
- 原有任务列表和模型继续使用 `~/Library/Application Support/YouDub`，未将用户数据放入应用包。

## 检查

| 检查 | 结果 |
| --- | --- |
| Host TypeScript | `npm run typecheck` 通过 |
| Setup 测试 | `node --import tsx --test packages/builtin/test/setup.test.ts`，2 项通过 |
| Host 启动测试 | `packages/builtin/test/bootstrap.test.ts` 在普通 Node 及内置 Node 22.23.2 的 `--expose-internals` 模式下均为 5 项通过 |
| 插件加载测试 | 内置 Node 22.23.2 使用 `--expose-internals --import tsx --test packages/builtin/test/extensions.test.ts`，9 项通过 |
| Setup 前端测试 | `npm --prefix apps/web test -- src/components/setup-gate.test.tsx`，5 项通过 |
| Python 配置与权限 | `.venv/bin/python -m pytest backend/tests/test_config.py backend/tests/test_file_permissions.py -q`，17 项通过 |
| 前端 lint | `npm --prefix apps/web run lint` 通过 |
| 桌面构建 | `npm run build:mac` 通过，包含 Next 生产构建、类型检查、Swift 编译和打包后的 Next 依赖解析检查；后续仅修改桌面入口、Host 加载、Python 配置与构建号，使用 `npm run build:mac -- --reuse-web` 复用已验收的前端产物 |
| 签名 | 所有 Mach-O 及外层应用签名，`codesign --verify --deep --strict` 通过 |
| 签名后启动 | 构建 20261015.5 在 `/Applications` 的工作台和 `/api/setup` 均 ready；退出后重新检查签名通过，应用包未被运行时改写且没有生成 `.cordis` |
| 动态库依赖 | 6 个 Mach-O 的 `otool -L` 检查通过，未引用本机 Homebrew 或其他外部绝对路径 |

## 首次发布验收（构建 20261015.5）

最终 DMG 公证及安装验收通过。按 [Apple 分发说明](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)，提交最外层 DMG，公证覆盖内部应用。

- 原安装包已保留于 `.cache/mac/build5-release/YouDub-0.1.0-macOS-arm64.dmg`。
- Apple 公证：`Accepted`，提交编号 `695cdb67-60a0-4a4f-8b9a-b697324596c0`；原回执保存于 `.cache/mac/build5-release/dmg-notary.json`。
- SHA-256：`868a1df2a2430ac7792f8383c49f1ecb0f2c9ca9e7df7ff6f1d368a13c975b29`，从最终文件重新计算并核对通过。
- DMG 及候选应用均成功附加公证票据，`stapler validate` 通过；Gatekeeper 返回 `accepted`、`Notarized Developer ID`。
- 最终 DMG 以只读方式挂载，内部应用构建号确认为 `20261015.5`，严格签名检查及 Gatekeeper 检查通过；从该 DMG 复制到 `/Applications/YouDub.app`，附加并验证应用票据后启动。
- 最终安装的应用独立窗口进入工作台；`/api/setup` 返回 `phase: ready`，四个环境步骤和四个模型均为 `ready`。脱敏回读保存于 `.cache/mac/final-installed-startup.json`；启动后 `codesign --verify --deep --strict` 再次通过。最终应用保留打开，未启动视频处理任务。
- 签名结束后已恢复原用户钥匙串搜索列表，仅保留 `login.keychain-db`，临时签名钥匙串已删除。

构建 20261015.5 已从 `/Applications/YouDub.app` 启动，实际进入工作台；`/api/setup` 返回 `phase: ready`，四个环境步骤和四个模型均为 `ready`。该次 API 读取已去除临时 setup token，保存于 `.cache/mac/build5-startup.json`。退出后严格签名检查通过，再将同一签名应用复制到候选目录，以 `--package-signed` 封装和公证。

## 已修复的首次候选失败

首次打包遗漏 Next standalone 的 node_modules，启动报缺少 Next；构建脚本已修复复制规则，并增加打包后依赖解析检查。随后发现 Finder 的 PATH 不包含应用专用 FFmpeg，修复后已实际进入工作台。旧候选的安装包和公证回执保留在 `.cache/mac/first-candidate/`，不作为最终交付。

第二个候选在源码目录启动通过，但安装到 `/Applications` 后，Python 配置错误地将应用包路径当成运行环境目录执行权限检查。桌面模式已改为仅从私有用户数据目录加载和校验 `.env`，代码包不承载运行时配置；原源码模式的检查保持不变。回归测试同时验证应用包保持只读，以及不安全的数据目录继续被拒绝。第二个候选和回执保留在 `.cache/mac/second-candidate/`；其应用公证已通过，DMG 的公证等待客户端因候选废弃而主动停止，未交付该候选。

第三个候选第一次签名时，系统日志返回 `leaf MissingIntermediate`；签名脚本立即失败并恢复原钥匙串搜索列表。核对 Apple 官方 G2 中间证书与上一份成功签名内的证书指纹一致后，将该公开证书补充到用户默认钥匙串，再次签名及严格验证通过。私钥继续仅导入临时钥匙串，未更改证书信任策略。

第三个候选成功启动后，严格签名检查发现新增 `.cordis/.gitignore` 和 `.cordis/resolve.mjs`。该候选废弃并停止公证等待客户端，证据保留在 `.cache/mac/third-candidate/`。桌面改用内置 Node 模块加载器；第四个候选因此暴露临时配置目录无法解析 `@youdub/builtin`，未提交公证。Host 已将临时配置的 `node_modules` 指向应用依赖，插件测试与第五个候选的签名后完整性验收通过。此前候选均不作为最终交付。

本次验收覆盖桌面打包、环境准备、模型可用性检查、工作台启动和错误复制。未重新运行完整视频翻译、配音推理任务；未验收 Intel Mac。
