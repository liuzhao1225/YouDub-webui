# 本地推理设备

桌面首次启动先检查硬件、驱动和已安装的 Torch，再安装兼容的 Torch、Torchaudio、TorchCodec 组合。其他依赖安装受约束文件限制，避免悄悄替换 GPU 版本。已经能运算的自定义 CUDA/ROCm/MPS 环境优先复用。应用不安装或升级显卡驱动。

| 环境 | 自动准备与任务设备 |
| --- | --- |
| NVIDIA Maxwell/Pascal 至 Hopper | Torch 2.8.0 / CUDA 12.6；检查驱动下限并实际运算；设备为 `cuda:N` |
| NVIDIA Blackwell | Torch 2.8.0 / CUDA 12.8；检查驱动下限并实际运算 |
| Apple Silicon | macOS Torch / MPS；设备为 `mps`；Whisper 因稀疏对齐数据限制使用 CPU，其他支持的模型可选择 MPS |
| AMD Linux | 已安装 ROCm 6.4 时使用官方 Torch 2.8.0 ROCm 6.4 包；现有可用的其他 ROCm 栈可以复用 |
| AMD Windows | 官方支持的 Radeon 型号与 Windows 11 使用 ROCm 7.2.1 / Torch 2.9.1；需要 AMD 26.2.2 驱动 |
| GPU 后端不可用 | 保留 CPU，环境准备页显示检测结果及回退信息 |

ROCm 在 Torch 中也使用 `cuda:N`，界面根据 `torch.version.hip` 标为 AMD ROCm。不能根据设备字符串把 AMD 误认为 NVIDIA。每张 GPU 经过小矩阵运算检查才会进入可选设备；结果按进程缓存，不加载模型、不访问网络。新任务优先选择可用 GPU，已有保存的选择保持不变。单个模型的算子、内存或精度限制仍由真实任务验证并报告。

Intel Mac 缺少本项目所需 Torch >= 2.5 的官方 wheel，需要自备兼容 Python 环境；不能将检测到 CPU 等同于所有依赖一定可安装。

Windows 和 macOS CI 运行设备策略与回退测试，Windows 另运行打包、原生窗口和进程清理验收。模拟后端测试不等同于 AMD/MPS 真机验收。

启动已经配置翻译服务的桌面应用后，可手工运行完整真实任务（会调用配置的翻译服务）：

```text
node scripts/test-real-localize.mjs http://127.0.0.1:PORT "视频路径.mp4" ".cache/real-localize"
```

脚本提交英文转中文任务，执行 Demucs、Whisper、翻译、VoxCPM2、Qwen 对齐与导出，保存状态和产物。会话令牌仅驻留内存。常规 CI 不下载这些模型或调用收费翻译服务。

版本依据：[PyTorch 历史版本](https://pytorch.org/get-started/previous-versions/)、[CUDA 架构支持变更](https://dev-discuss.pytorch.org/t/cuda-toolkit-version-and-architecture-support-update-maxwell-and-pascal-architecture-support-removed-in-cuda-12-8-and-12-9-builds/3128)、[TorchCodec 兼容表](https://github.com/pytorch/torchcodec#installing-torchcodec)、[AMD Windows 安装](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/install/installrad/windows/install-pytorch.html)、[AMD Windows 兼容矩阵](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/compatibility/compatibilityrad/windows/windows_compatibility.html)。
