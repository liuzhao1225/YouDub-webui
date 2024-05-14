
# YouDub-webui: 优质视频中文化工具
## 目录
- [YouDub-webui: 优质视频中文化工具](#youdub-webui-优质视频中文化工具)
  - [目录](#目录)
  - [简介](#简介)
  - [主要特点](#主要特点)
  - [安装与使用指南](#安装与使用指南)
    - [1. 克隆仓库](#1-克隆仓库)
    - [2. 安装依赖](#2-安装依赖)
      - [自动安装](#自动安装)
      - [手动安装](#手动安装)
    - [3. 环境设置](#3-环境设置)
    - [4. 运行程序](#4-运行程序)
      - [自动运行](#自动运行)
      - [手动运行](#手动运行)
  - [使用步骤](#使用步骤)
    - [1. **全自动 (Do Everything)**](#1-全自动-do-everything)
    - [2. **下载视频 (Download Video)**](#2-下载视频-download-video)
    - [3. **人声分离 (Demucs Interface)**](#3-人声分离-demucs-interface)
    - [4. **语音识别 (Whisper Inference)**](#4-语音识别-whisper-inference)
    - [5. **字幕翻译 (Translation Interface)**](#5-字幕翻译-translation-interface)
    - [6. **语音合成 (TTS Interface)**](#6-语音合成-tts-interface)
    - [7. **视频合成 (Synthesize Video Interface)**](#7-视频合成-synthesize-video-interface)
  - [技术细节](#技术细节)
    - [AI 语音识别](#ai-语音识别)
    - [大型语言模型翻译](#大型语言模型翻译)
    - [AI 声音克隆](#ai-声音克隆)
    - [视频处理](#视频处理)
  - [贡献指南](#贡献指南)
  - [许可协议](#许可协议)
  - [支持与联系方式](#支持与联系方式)

## 简介
`YouDub-webui` 是 [`YouDub`](https://github.com/liuzhao1225/YouDub) 项目的网页交互版本，基于 `Gradio` 构建，为用户提供简易操作界面来访问和使用 [`YouDub`](https://github.com/liuzhao1225/YouDub) 的强大功能。[`YouDub`](https://github.com/liuzhao1225/YouDub) 是一个开创性的开源工具，旨在将 YouTube 和其他平台上的高质量视频翻译和配音成中文版本。该工具结合了最新的 AI 技术，包括语音识别、大型语言模型翻译，以及 AI 声音克隆技术，提供与原视频相似的中文配音，为中文用户提供卓越的观看体验。

`YouDub-webui` 适用于多种场景，包括教育、娱乐和专业翻译，特别适合那些希望将国外优秀视频内容本地化的用户。此工具的简洁界面使得即使是非技术用户也能轻松上手，实现视频的快速中文化处理。

了解更多关于 `YouDub-webui` 的信息和示例，请访问我们的 [bilibili 视频主页](https://space.bilibili.com/1263732318)。为了更好地服务社区，我们也设立了微信群组，欢迎通过扫描下方的[二维码](#支持与联系方式)加入我们，共同探讨和贡献于 `YouDub-webui` 的发展。


当然，我将重新撰写 `YouDub-webui` 的主要特点部分。

---

## 主要特点
`YouDub-webui` 融合了多项先进技术，提供了一套完整的视频中文化工具包，其主要特点包括：

- **视频下载**: 支持通过链接直接下载 YouTube 视频。无论是单个视频、播放列表还是频道内的多个视频，均能轻松下载。
- **AI 语音识别**: 利用先进的 AI 技术，将视频中的语音高效转换为文字。不仅提供精确的语音到文本转换，还能自动对齐时间并识别不同说话者，极大地增强了信息的丰富性和准确性。
- **大型语言模型翻译**: 结合大型语言模型如 GPT，实现快速且精准的中文翻译。无论是俚语还是专业术语，均能得到恰当的翻译，确保内容的准确性与地道性。
- **AI 声音克隆**: 通过 AI 声音克隆技术，生成与原视频配音相似的中文语音。这不仅提升了视频的观看体验，也保留了原视频的情感和语调特色。
- **视频处理**: 综合了音视频同步处理、字幕添加、视频播放速度调整和帧率设置等多项功能。用户可以根据需要生成高质量的最终视频，实现无缝的观看体验。
- **自动上传**: 支持将最终视频自动上传到 Bilibili 平台。用户可以在不离开 `YouDub-webui` 的情况下，将视频上传到 Bilibili 平台，实现一键式的视频中文化处理。

`YouDub-webui` 的这些特点使其成为一个强大且易于使用的视频中文化工具，无论是个人用户还是专业团队，都能从中受益。


## 安装与使用指南

为了使用 `YouDub-webui`，请遵循以下步骤来安装和配置您的环境：

### 1. 克隆仓库
首先，克隆 `YouDub-webui` 仓库到您的本地系统：
```bash
git clone https://github.com/liuzhao1225/YouDub-webui.git
```

### 2. 安装依赖
您可以选择自动安装或手动安装依赖：

#### 自动安装
- 进入 `YouDub-webui` 目录，运行 `setup_windows` 脚本。
- 脚本会在当前目录创建一个 `venv` 虚拟环境，并自动安装所需依赖，包括 CUDA 12.1 版本的 PyTorch。

#### 手动安装
- 进入 `YouDub-webui` 目录，使用以下命令安装依赖：
  ```bash
  cd YouDub-webui
  pip install -r requirements.txt
  ```
- 由于 TTS 依赖的特殊性，所以将 TTS 移出了 `requirements.txt`，需要手动安装：
  ```bash
  pip install TTS
  ```
- 默认安装为 CPU 版本的 PyTorch 如果你需要手动安装特定 CUDA 版本的 PyTorch，可根据您的 CUDA 版本从 [PyTorch 官方网站](https://pytorch.org/) 获取安装命令。

### 3. 环境设置
在运行前，请配置环境变量：

- **环境变量配置**：将 `.env.example` 改名为 `.env` 并填入以下环境变量：
  - `OPENAI_API_KEY`: OpenAI API 密钥，格式通常为 `sk-xxx`。
  - `MODEL_NAME`: 模型名称，如 'gpt-4' 或 'gpt-3.5-turbo'。
  - `OPENAI_API_BASE`: OpenAI API 基础 URL，如果使用自己部署的模型，请填入。
  - `HF_TOKEN`: Hugging Face token，用于 speaker diarization 功能。
  - `HF_ENDPOINT`: 如果从 `huggingface` 下载模型时出错，可以添加此环境变量。
  - `APPID` 和 `ACCESS_TOKEN`: 火山引擎 TTS 所需的凭据。
  - `BILI_BASE64`: Bilibili API 所需的凭据。获取方法请参考 [bilibili-toolman 准备凭据](https://github.com/mos9527/bilibili-toolman?tab=readme-ov-file#%E5%87%86%E5%A4%87%E5%87%AD%E6%8D%AE)。

### 4. 运行程序
选择以下任一方式运行程序：

#### 自动运行
- 在 `YouDub-webui` 目录下运行 `run_windows.bat`。

#### 手动运行
- 使用以下命令启动主程序：
  ```bash
  python app.py
  ```

## 使用步骤

### 1. **全自动 (Do Everything)**

此界面是一个一站式的解决方案，它将执行从视频下载到视频合成的所有步骤。

- **Root Folder**: 设置视频文件的根目录。
- **Video URL**: 输入视频或播放列表或频道的URL。
- **Number of videos to download**: 设置要下载的视频数量。
- **Resolution**: 选择下载视频的分辨率。
- **Demucs Model**: 选择用于音频分离的Demucs模型。
- **Demucs Device**: 选择音频分离的处理设备。
- **Number of shifts**: 设置音频分离时的移位数。
- **Whisper Model**: 选择用于语音识别的Whisper模型。
- **Whisper Download Root**: 设置Whisper模型的下载根目录。
- **Whisper Batch Size**: 设置Whisper处理的批量大小。
- **Whisper Diarization**: 选择是否进行说话者分离。
- **Translation Target Language**: 选择字幕的目标翻译语言。
- **Force Bytedance**: 选择是否强制使用Bytedance语音合成。
- **Subtitles**: 选择是否在视频中包含字幕。
- **Speed Up**: 设置视频播放速度。
- **FPS**: 设置视频的帧率。
- **Max Workers**: 设置处理任务的最大工作线程数。
- **Max Retries**: 设置任务失败后的最大重试次数。
- **Auto Upload Video**: 选择是否自动上传视频到Bilibili。

### 2. **下载视频 (Download Video)**

此界面用于单独下载视频。

- **Video URL**: 输入视频或播放列表或频道的URL。
- **Output Folder**: 设置视频下载后的输出文件夹。
- **Resolution**: 选择下载视频的分辨率。
- **Number of videos to download**: 设置要下载的视频数量。

### 3. **人声分离 (Demucs Interface)**

此界面用于从视频中分离人声。

- **Folder**: 设置包含视频的文件夹。
- **Model**: 选择用于音频分离的Demucs模型。
- **Device**: 选择音频分离的处理设备。
- **Progress Bar in Console**: 选择是否在控制台显示进度条。
- **Number of shifts**: 设置音频分离时的移位数。

### 4. **语音识别 (Whisper Inference)**

此界面用于从视频音频中进行语音识别。

- **Folder**: 设置包含视频的文件夹。
- **Model**: 选择用于语音识别的Whisper模型。
- **Download Root**: 设置Whisper模型的下载根目录。
- **Device**: 选择语音识别的处理设备。
- **Batch Size**: 设置Whisper处理的批量大小。
- **Diarization**: 选择是否进行说话者分离。

### 5. **字幕翻译 (Translation Interface)**

此界面用于将识别出的语音转换为字幕并翻译。

- **Folder**: 设置包含视频的文件夹。
- **Target Language**: 选择字幕的目标翻译语言。

### 6. **语音合成 (TTS Interface)**

此界面用于将翻译后的文字转换为语音。

- **Folder**: 设置包含视频的文件夹。
- **Force Bytedance**: 选择是否强制使用Bytedance语音合成。

### 7. **视频合成 (Synthesize Video Interface)**

此界面用于将视频、字幕和语音合成为最终视频。

- **Folder**: 设置包含视频的文件夹。
- **Subtitles**: 选择是否在视频中包含字幕。
- **Speed Up**: 设置视频播放速度。
- **FPS**: 设置视频的帧率。
- **Resolution**: 选择视频的分辨率。

## 技术细节

### AI 语音识别
我们的 AI 语音识别功能现在基于 [WhisperX](https://github.com/m-bain/whisperX) 实现。WhisperX 是一个高效的语音识别系统，建立在 OpenAI 开发的 Whisper 系统之上。它不仅能够精确地将语音转换为文本，还能自动对齐时间，并识别每句话的说话人物。这种先进的处理方式不仅提高了处理速度和准确度，还为用户提供了更丰富的信息，例如说话者的识别。

### 大型语言模型翻译
我们的翻译功能继续使用 OpenAI API 提供的各种模型，包括官方的 GPT 模型。同时，我们也在利用诸如 [api-for-open-llm](https://github.com/xusenlinzy/api-for-open-llm) 这样的项目，这使我们能够更灵活地整合和利用不同的大型语言模型进行翻译工作，确保翻译质量和效率。

### AI 声音克隆
在声音克隆方面，我们已经转向使用 [Coqui AI TTS](https://github.com/coqui-ai/TTS)。同时，对于单一说话人的情况，我们采用了火山引擎进行 TTS，以获得更优质的音质。火山引擎的高级技术能够生成极其自然且流畅的语音，适用于各种应用场景，提升了最终产品的整体质量。

### 视频处理
在视频处理方面，我们依然强调音视频的同步处理。我们的目标是确保音频与视频画面的完美对齐，并生成准确的字幕，从而为用户提供一个无缝且沉浸式的观看体验。我们的处理流程和技术确保了视频内容的高质量和观看的连贯性。


## 贡献指南
欢迎对 `YouDub-webui` 进行贡献。您可以通过 [GitHub Issues](https://github.com/liuzhao1225/YouDub-webui/issues) 或 [Pull Request](https://github.com/liuzhao1225/YouDub-webui/pulls) 提交改进建议或报告问题。

## 许可协议
`YouDub-webui` 遵循 Apache License 2.0。使用本工具时，请确保遵守相关的法律和规定，包括版权法、数据保护法和隐私法。未经原始内容创作者和/或版权所有者许可，请勿使用此工具。

## 支持与联系方式
如需帮助或有任何疑问，请通过 [GitHub Issues](https://github.com/liuzhao1225/YouDub-webui/issues) 联系我们。
加入我们的Discord服务器进行讨论和获取支持：[Discord服务器](https://discord.gg/vbkYnN2Rrm)
你也可以加入我们的微信群，扫描下方的二维码即可：

![WeChat Group](https://github.com/liuzhao1225/YouDub/blob/main/docs/d50300d5db9d8cc71861174fc5d33b1.jpg)
