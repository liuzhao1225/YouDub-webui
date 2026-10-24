import React from 'react'
import { Studio } from '../../../web/src/plugin/builtin/studio'
import { useFeatures } from './runtime'
import { useText } from './i18n'
import { PageHeader } from '../../../web/src/components/page-layout'
export function StudioPage() { const tx=useText();return <><PageHeader title={tx('client.workbench')} /><Studio {...useFeatures()} /></> }
