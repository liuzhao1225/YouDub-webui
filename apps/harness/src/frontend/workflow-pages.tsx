import React from 'react'
import { WorkflowLibrary, WorkflowRoute } from '../../../web/src/plugin/builtin/workflows'
import { useFeatures } from './runtime'
export function WorkflowsPage() { return <WorkflowLibrary {...useFeatures()} /> }
export function WorkflowPage({ params }:any) { return <WorkflowRoute {...useFeatures()} params={params} /> }
