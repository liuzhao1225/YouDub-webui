import { youdubContext } from '@youdub/harness-subtitles';
import * as domain from './domain.mjs';
export const name = 'harness-example-graph-text-review';
export const inject = ['youdubDomain'];
export async function apply(ctx) {
  await youdubContext(ctx).plugin(domain, { $plugin: { id: 'example.graph-text-review', version: '1.0.0', integrity: 'sha256:11e2d092ba8aca6968e3b31eb9833422748673400821061f2a14acbca3b9056b' } });
}
