import React from 'react'
import { SettingsResources } from '../../../web/src/components/settings-resources'
import { useFeatures } from './runtime'
export function ResourcesPage() { return <div className="yd-feature-page"><SettingsResources request={useFeatures().request} /></div> }
