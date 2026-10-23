import React from 'react'
import { Studio } from '../../../web/src/plugin/builtin/studio'
import { useFeatures } from './runtime'
import { Link } from './sdk'
import { useText } from './i18n'
import { PageHeader } from '../../../web/src/components/page-layout'
export function StudioPage() { const tx=useText();return <><PageHeader title={tx('client.workbench')} /><Studio {...useFeatures()} examplesLink={<Link href="/examples" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{tx("studio.page.view.built.in.examples")}</Link>} /></> }
