import { useState } from 'react';
import { Button, IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives';
export const inject = ['slots'];
function Page() {
  const [count, setCount] = useState(0);
  return <section className="yd-feature-page" data-testid="external-text-page"><h1>外部文本插件</h1><Button data-testid="external-text-counter" onClick={() => setCount(value => value + 1)}>点击次数：{count}</Button></section>;
}
function Navigation({ navigate, collapsed }) {
  return <Button icon={<IconDeliverDocRegular />} aria-label="外部文本插件" onClick={() => navigate('/plugins/file-transform')}>{!collapsed && '外部文本插件'}</Button>;
}
function Panel({ task }) {
  return task.workflowId !== 'example.uppercase' ? null : <section data-testid="external-transform-panel"><h3>外部文本插件</h3><p>UTF-8 文本转换完成后可下载大写文本。</p></section>;
}
export function apply(ctx) {
  for (const [name, key, component] of [['youdub.page', '/plugins/file-transform', Page], ['youdub.navigation', 'example.file-transform', Navigation], ['youdub.task.detail.panels', 'example.file-transform', Panel]]) {
    ctx.slots.inject(name, () => ctx.slots.register({ name, ...(name === 'youdub.page' ? { key } : { id:key }) }, component));
  }
}
