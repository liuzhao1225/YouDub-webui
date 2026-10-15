'use client'
import { useEffect, useState } from 'react'
import { SetupScreen, type SetupState, type SetupAction } from '@/components/setup-screen'

// Design-only fixture. The application root reads real progress from /api/setup.
function fixture(started = true): SetupState {
  return { phase: 'models', platform: 'darwin', arch: 'arm64', canRetry: true, token: '',
    environment: ['Python 3.12', '运行依赖', 'FFmpeg', '分句资源'].map(name => ({ id: name, name, status: 'ready' })),
    models: [
      { id: 'whisper', name: 'Whisper', variant: 'tiny', purpose: '语音识别', total: 75_572_083, speed: 3_200_000, initial: 1 },
      { id: 'voxcpm', name: 'VoxCPM2', variant: '', purpose: '声音克隆', total: 4_960_722_408, speed: 24_600_000, initial: 0.42 },
      { id: 'demucs', name: 'Demucs', variant: 'htdemucs', purpose: '人声分离', total: 84_141_911, speed: 1_400_000, initial: 0.76 },
      { id: 'qwen', name: 'Qwen3 Aligner', variant: '0.6B', purpose: '字幕对齐', total: 1_847_225_867, speed: 9_800_000, initial: 0.28 },
    ].map(({ initial, ...model }) => ({ ...model, status: !started ? 'paused' : initial === 1 ? 'ready' : 'downloading', received: started ? Math.floor(model.total * initial) : 0, speed: started && initial < 1 ? model.speed : 0 })),
  }
}
export default function ModelSetupPreview() {
  const [state, setState] = useState(fixture)
  useEffect(() => {
    const timer = setInterval(() => setState(current => {
      const models = current.models.map(model => {
        if (model.status !== 'downloading') return model
        const received = Math.min(model.total, model.received + model.speed)
        return { ...model, received, status: received === model.total ? 'ready' as const : model.status, speed: received === model.total ? 0 : model.speed }
      })
      return { ...current, models, phase: models.every(model => model.status === 'ready') ? 'ready' : 'models' }
    }), 1000)
    return () => clearInterval(timer)
  }, [])
  function action(action: SetupAction, id?: string) {
    const rates = [3_200_000, 24_600_000, 1_400_000, 9_800_000]
    setState(current => ({ ...current, models: current.models.map((model, index) => model.status === 'ready' || (id && model.id !== id) ? model : { ...model, status: action === 'pause' ? 'paused' : 'downloading', speed: action === 'pause' ? 0 : rates[index] }) }))
  }
  return <SetupScreen state={state} onAction={action} onReset={() => setState(fixture(false))} />
}
