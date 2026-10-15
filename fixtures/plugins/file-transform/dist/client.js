import React from 'react'

export const name = 'example-file-transform-client'
export const inject = ['slots']
function Page() {
  const [count, setCount] = React.useState(0)
  return React.createElement('section', { className: 'space-y-4', 'data-testid': 'external-text-page' },
    React.createElement('h1', null, '外部文本插件'),
    React.createElement('button', {
      type: 'button', className: 'rounded-xl border px-4 py-2',
      'data-testid': 'external-text-counter', onClick: () => setCount(value => value + 1),
    }, `点击次数：${count}`))
}
function Panel({ task }) {
  if (task.workflowId !== 'example.uppercase') return null
  return React.createElement('section', { 'data-testid': 'external-transform-panel', className: 'rounded-xl border p-4' },
    React.createElement('h3', null, '外部文本插件'),
    React.createElement('p', null, 'UTF-8 文本转换完成后可下载大写文本。'))
}
export function apply(ctx) {
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'example-file-transform-page', path: '/extensions/text', component: Page, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'example-file-transform-navigation', label: '外部文本插件', routeId: 'example-file-transform-page', order: 40 }))
  ctx.effect(() => ctx.slots.register('task.detail.panels', { id: 'example.file-transform', component: Panel }))
}
