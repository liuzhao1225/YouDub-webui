
# YouDub-webui: 优质视频中文化工具
## 目录
- [YouDub-webui: 优质视频中文化工具](#youdub-webui-优质视频中文化工具)
  - [目录](#目录)
  - [简介](#简介)
  - [主要特点](#主要特点)
  - [安装与使用指南](#安装与使用指南)
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
`YouDub-webui` 是 [`YouDub`](https://github.com/liuzhao1225/YouDub) 的网页交互版本。这个工具通过其网页界面简化了操作流程，使用户能够更方便地访问和使用 [`YouDub`](https://github.com/liuzhao1225/YouDub) 的强大功能。。[`YouDub`](https://github.com/liuzhao1225/YouDub) 是一个创新的开源工具，专注于将 YouTube 等平台的优质视频翻译和配音为中文版本。此工具融合了先进的 AI 技术，包括语音识别、大型语言模型翻译以及 AI 声音克隆技术，为中文用户提供具有原始 YouTuber 音色的中文配音视频。更多示例和信息，欢迎访问我的[bilibili视频主页](https://space.bilibili.com/1263732318)。你也可以加入我们的微信群，扫描下方的[二维码](#支持与联系方式)即可。

## 主要特点
- **视频下载**: 通过视频链接下载 YouTube 视频。
- **AI 语音识别**：有效转换视频中的语音为文字。
- **大型语言模型翻译**：快速且精准地将文本翻译成中文。
- **AI 声音克隆**：生成与原视频配音相似的中文语音。
- **视频处理**：集成的功能实现音视频的同步处理。

## 安装与使用指南
1. **克隆仓库**：
   ```bash
   git clone https://github.com/liuzhao1225/YouDub-webui.git
   ```
2. **安装依赖**：
   1. **自动安装**
   
        进入 `YouDub-webui` 目录并运行 `run_windows.bat`。
        这个脚本会自动在当前目录下创建 `venv` 虚拟环境，并安装所需依赖。这个脚本会自动安装 CUDA 12.1 版本的 PyTorch。

   2. **手动安装**
   
        进入 `YouDub-webui` 目录并安装所需依赖：
        ```bash
        cd YouDub-webui
        pip install -r requirements.txt
        ```
        由于 `TTS` 的依赖限定的比较傻逼，所以将 `TTS`移出了 `requirements.txt`，需要手动安装。安装 `TTS` 依赖的步骤如下：
        ```bash
        pip install TTS
        ```

        默认安装为 CPU 版本的 PyTorch 如果你需要手动安装特定 CUDA 版本的 PyTorch，可以参考以下步骤：
        首先，根据你的环境和 PyTorch 的版本，从 [PyTorch 官方网站](https://pytorch.org/) 获取适用的安装命令。例如，如果你的 CUDA 版本是 11.8，你可以使用如下命令安装 PyTorch：
        ```bash
        pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
        ```
3. **环境设置**

      在运行程序之前，需要进行以下环境设置：

      **环境变量配置**：将 `.env.example` 文件改名为 `.env`，并填入相应的环境变量。以下是需要配置的环境变量：

      - `OPENAI_API_KEY`: OpenAI API 的密钥，一般格式为 `sk-xxx`。
      - `MODEL_NAME`: 使用的模型名称，如 'gpt-4' 或 'gpt-3.5-turbo'。对于翻译任务，使用 'gpt-3.5-turbo'足够了。'gpt-4'太贵了，一天干了我一百多刀。
      - `OPENAI_API_BASE`: 如果你使用的是 OpenAI 官方的 API，可以将此项留空。如果你有自己部署的支持 OpenAI API 的大模型，可以填入相应的 OpenAI API 访问的 base_url。
      - `HF_TOKEN`: 如果使用 speaker diarization 功能，需要提供你的 Hugging Face token，并同意 [pyannote's speaker diarization agreement](https://huggingface.co/pyannote/speaker-diarization-3.1)。`HF_TOKEN` 可以在 [Hugging Face 设置](https://huggingface.co/settings/tokens) 中获取。
      - `HF_ENDPOINT`: 如果在从 `huggingface` 下载模型时报错，你可以在 `.env` 文件中添加：
  
        ```
        HF_ENDPOINT=https://hf-mirror.com
        ```

      - `APPID` 和 `ACCESS_TOKEN`: 如果使用火山引擎的 TTS，需要提供火山引擎的 APPID 和 ACCESS_TOKEN，此项可能需要付费。

4. **运行程序**：
   1. **自动运行**

        进入 `YouDub-webui` 目录并运行 `run_windows.bat`。

    2. **手动运行**
        使用以下命令启动主程序：

        ```
        python app.py
        ```

   如果在从 `huggingface` 下载模型时报错，你可以在 `.env` 文件中添加：

   ```
   HF_ENDPOINT=https://hf-mirror.com
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
欢迎对 `YouDub-webui` 进行贡献。您可以通过 GitHub Issue 或 Pull Request 提交改进建议或报告问题。

## 许可协议
`YouDub-webui` 遵循 Apache License 2.0。使用本工具时，请确保遵守相关的法律和规定，包括版权法、数据保护法和隐私法。未经原始内容创作者和/或版权所有者许可，请勿使用此工具。

## 支持与联系方式
如需帮助或有任何疑问，请通过 [GitHub Issues](https://github.com/liuzhao1225/YouDub-webui/issues) 联系我们。你也可以加入我们的微信群，扫描下方的二维码即可：

![WeChat Group](docs/1e5bad6485828197234ab8722f3f646.jpg)
