import React from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
export const inject = ['slots'];
function TextReviewDetails({ detail, outputs, draft, readOnly, onDraftChange, navigate }) {
  const value = draft.text ?? outputs.text;
  if (!value) return null;
  return <section data-testid="external-graph-review"><h2>文本校对</h2><label>校对文本<textarea aria-label="校对文本" data-testid="external-graph-text" value={value.text} disabled={readOnly} onChange={event => onDraftChange({ ...draft, text:{ ...value, text:event.target.value } })} /></label><p>来源数量：{outputs.metadata?.sources ?? 0}</p><Button onClick={() => navigate(`/tasks/${detail.taskId}`)}>返回工作流</Button></section>;
}
export function apply(ctx) {
  ctx.slots.inject('youdub.workflow.node.details', () => ctx.slots.register({ name:'youdub.workflow.node.details', id:'example.text-review.details' }, TextReviewDetails));
}
