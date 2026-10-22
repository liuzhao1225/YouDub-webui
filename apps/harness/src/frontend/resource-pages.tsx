import React from 'react'
import { SettingsResources } from '../../../web/src/components/settings-resources'
import { Page } from '../../../web/src/components/page-layout'
import { useFeatures } from './runtime'
import { useText } from './i18n'
export function ResourcesPage() { const tx = useText(); return <Page><SettingsResources title={tx('client.resources')} request={useFeatures().request} /></Page> }
