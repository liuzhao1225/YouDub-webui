import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const common = { bundle: true, absWorkingDir: here, logLevel: 'info' };
await build({ ...common, entryPoints: ['src/host.mjs'], outfile: 'dist/host.mjs', platform: 'node', format: 'esm', packages: 'external' });
await build({ ...common, entryPoints: ['src/client.jsx'], outfile: 'dist/client.js', platform: 'browser', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'], loader: { '.css': 'text' }, nodePaths: [resolve(here, 'node_modules')],
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
      const variables = selector => Object.fromEntries([...block(selector).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
      const light = variables(':root'), dark = { ...light, ...variables('.dark') };
      const tokens = Object.fromEntries(Object.entries(light).map(([name, value]) => [name, { light: value, dark: dark[name] }]));
      const aliases = {
        'bg-base': 'background', 'bg-layer-1': 'card', 'bg-layer-2': 'elevated', 'bg-overlay': 'popover',
        'label-primary': 'foreground', 'label-secondary': 'muted-foreground', 'label-tertiary': 'muted-foreground',
        'label-caption': 'subtle-foreground', 'label-dimmed': 'subtle-foreground', 'label-primary-foreground': 'primary-foreground',
        'border-l1': 'border', 'border-l2': 'border', 'border-l3': 'border', 'border-l4': 'input',
        'brand-primary': 'primary', 'button-primary-fill': 'primary', 'button-primary-hover': 'primary-hover',
        'button-tool-bar-fill': 'muted', 'button-tool-bar-hover': 'accent',
        'interactive-bg-hover': 'accent', 'interactive-bg-active': 'muted',
        'state-business-primary': 'brand-blue', 'state-success-primary': 'status-success-fg',
        'state-error-primary': 'status-danger-fg', 'state-warn-primary': 'status-warning-fg',
      };
      for (const [alias, name] of Object.entries(aliases)) tokens['--dsw-alias-' + alias] = tokens['--' + name];
      tokens['--dsw-specific-sidebar-fill'] = tokens['--surface'];
      const theme = ['eq', 'shimmer', 'rise', 'drift'].map(name => '@keyframes yd-' + name + block('@keyframes ' + name)).join('\n');
      return { contents: 'export const tokens = ' + JSON.stringify(tokens) + ';export default ' + JSON.stringify(theme), loader: 'js' };
    });
  } }],
  banner: { js: 'window.__ModuleLoader__.load({id:"@youdub/harness-subtitles",factory:(require)=>{const module={exports:{}};const exports=module.exports;' },
  footer: { js: 'return module.exports;}});' } });
