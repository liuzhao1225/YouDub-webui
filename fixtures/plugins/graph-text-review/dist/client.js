import React from 'react'
import { useClient } from '@youdub/sdk/client'

export const name = 'example-graph-text-review-client'
export const inject = ['slots']

function TextReviewDetails({ detail, outputs, draft, readOnly, onDraftChange }) {
  const { navigation } = useClient()
  const value = draft.text ?? outputs.text
  if (!value) return null
  return React.createElement('section', { className: 'space-y-4', 'data-testid': 'external-graph-review' },
    React.createElement('h2', { className: 'font-semibold' }, '文本校对'),
    React.createElement('label', { className: 'grid gap-2 text-sm' }, '校对文本',
      React.createElement('textarea', {
        'aria-label': '校对文本', 'data-testid': 'external-graph-text',
        className: 'min-h-40 w-full rounded-lg border border-input bg-input-bg p-3 text-foreground focus-visible:outline-ring',
        value: value.text, disabled: readOnly,
        onChange: event => onDraftChange({ ...draft, text: { ...value, text: event.target.value } }),
      })),
    React.createElement('p', { className: 'text-sm text-muted-foreground' }, `来源数量：${outputs.metadata?.sources ?? 0}`),
    React.createElement('button', {
      type: 'button', className: 'text-sm text-link',
      onClick: () => navigation.push(`/tasks/${detail.taskId}`),
    }, '返回工作流'))
}

export function apply(ctx) {
  ctx.effect(() => ctx.slots.register('workflow.node.details', { id: 'example.text-review.details', component: TextReviewDetails }))
}
