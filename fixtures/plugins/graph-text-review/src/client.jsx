import React, { useId } from 'react';
import { Textarea } from '@deepseek-ai/dsh-client-ui-primitives';
export const inject = ['slots'];
function TextReviewDetails({ outputs, draft, readOnly, onDraftChange }) {
  const fieldId = useId();
  const value = draft.text ?? outputs.text;
  if (!value) return null;
  return <section data-testid="external-graph-review" style={{ display: 'grid', gap: '0.5rem' }}>
    <label htmlFor={fieldId}>校对文本</label>
    <Textarea id={fieldId} data-testid="external-graph-text" rows={6} value={value.text} readOnly={readOnly}
      onChange={event => onDraftChange({ ...draft, text: { ...value, text: event.target.value } })} />
  </section>;
}
export function apply(ctx) {
  ctx.slots.inject('youdub.workflow.node.details', () => ctx.slots.register({ name:'youdub.workflow.node.details', id:'example.text-review.details' }, TextReviewDetails));
}
