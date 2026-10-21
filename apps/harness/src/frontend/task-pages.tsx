import React from 'react'
import { Library, TaskDetail } from '../../../web/src/plugin/builtin/library'
import { TaskNodePage } from '../../../web/src/plugin/builtin/workflow-task'
import { useFeatures } from './runtime'
export function TasksPage() { return <Library {...useFeatures()} /> }
export function TaskPage({ params }:any) { return <TaskDetail {...useFeatures()} params={params} /> }
export function NodePage({ params }:any) { return <TaskNodePage {...useFeatures()} params={params} /> }
