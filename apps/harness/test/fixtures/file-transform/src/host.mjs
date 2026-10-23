import { youdubContext } from '@youdub/harness-subtitles';
import * as domain from './domain.mjs';
export const name = 'harness-example-file-transform';
export const inject = ['youdubDomain'];
export async function apply(ctx) {
  await youdubContext(ctx).plugin(domain, { $plugin: { id: 'example.file-transform', version: '1.0.0', integrity: 'sha256:73e8bcb1366ef600ca2645e6a7c022632cfd9dbc1b51eb37837c62c6dc50766b' } });
}
