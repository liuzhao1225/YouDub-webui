import React from 'react'
import { Studio } from '../../../web/src/plugin/builtin/studio'
import { useFeatures } from './runtime'
import { Link } from './sdk'
import { useText } from './i18n'
export function StudioPage() { const tx=useText();return <Studio {...useFeatures()} examplesLink={<Link href="/examples" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{tx('View built-in examples','查看内置示例','内蔵サンプルを見る')}</Link>} /> }
