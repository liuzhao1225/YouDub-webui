import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const common = { bundle: true, absWorkingDir: here, logLevel: 'info' };
await build({ ...common, entryPoints: ['src/host.mjs'], outfile: 'dist/host.mjs', platform: 'node', format: 'esm', packages: 'external' });
await build({ ...common, entryPoints: [resolve(root, 'packages/builtin/src/process.ts')], outfile: 'dist/process.mjs', platform: 'node', format: 'esm',
  external: ['@deepseek-ai/cordis'], alias: { cordis: '@deepseek-ai/cordis', '@youdub/sdk': resolve(root, 'packages/sdk/src/index.ts') } });
await build({ ...common, entryPoints: ['src/client.jsx'], outfile: 'dist/client.js', platform: 'browser', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'], loader: { '.css': 'text' }, nodePaths: [resolve(here, 'node_modules')],
  alias: { '@': resolve(root, 'apps/web/src') },
  plugins: [{ name: 'original-youdub-theme', setup(builder) {
    builder.onResolve({ filter: /^youdub:theme$/ }, () => ({ path: 'theme', namespace: 'youdub-theme' }));
    builder.onLoad({ filter: /.*/, namespace: 'youdub-theme' }, async () => {
      const css = await readFile(resolve(root, 'apps/web/src/app/globals.css'), 'utf8');
      function block(selector) {
        const start = css.indexOf(selector + ' {');
        if (start < 0) throw new Error(`Original YouDub theme no longer declares ${selector}`);
        const open = css.indexOf('{', start); let depth = 1, end = open + 1;
        for (; depth && end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; }
        if (depth) throw new Error(`Unclosed original theme block: ${selector}`);
        return css.slice(open, end);
      }
      const theme = '.yd' + block(':root') + '\n.yd.dark' + block('.dark') + '\n' +
        ['eq', 'shimmer', 'rise', 'drift'].map(name => '@keyframes yd-' + name + block('@keyframes ' + name)).join('\n');
      return { contents: 'export default ' + JSON.stringify(theme), loader: 'js' };
    });
  } }],
  banner: { js: 'window.__ModuleLoader__.load({id:"@youdub/harness-subtitles",factory:(require)=>{const module={exports:{}};const exports=module.exports;' },
  footer: { js: 'return module.exports;}});' } });
