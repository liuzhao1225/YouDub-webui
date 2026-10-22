import { checkLocales } from './check-locales.mjs';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { readFrameworkSource } from './baselines/framework-source.mjs';
await checkLocales();
const root = fileURLToPath(new URL('../..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const web = resolve(root, 'apps/web');
const frontend = resolve(here, 'src/frontend');
const webRequire = createRequire(resolve(web, 'package.json'));
const product = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
// Reuse the unchanged upstream preset from the complete source build.
const framework = resolve(root, '.cache/harness/source-build');
const presetPath = resolve(framework, 'packages/client/tsdown.client.ts');
const officialManifest = await readFrameworkSource(root);
const frameworkReceipt = JSON.parse(await readFile(resolve(framework, 'youdub-source-build.json'), 'utf8'));
if (frameworkReceipt.sourceTreeSha256 !== officialManifest.sha256) throw new Error('Rebuild the framework before building the current YouDub source.');
const officialPackages = new Map(officialManifest.packages.map(pkg => [pkg.name, pkg.path]));
const officialExternals = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-store'];
const sourceBuiltImports = { name: 'source-built-official-imports', setup(builder) {
  builder.onResolve({ filter: /^@deepseek-ai\// }, args => {
    if (officialExternals.some(name => args.path === name || args.path.startsWith(name + '/'))) return { path: args.path, external: true };
    const name = args.path.split('/').slice(0, 2).join('/');
    const directory = officialPackages.get(name);
    if (!directory) throw new Error(`Official source missing for bundled import: ${args.path}`);
    return { path: createRequire(resolve(framework, directory, 'package.json')).resolve(args.path) };
  });
} };
const { clientBundle } = await import(pathToFileURL(presetPath));
const officialClient = clientBundle(here, ['src/host.mjs'])({}).find(config => config.platform === 'browser');
const assetPlugins = officialClient.plugins.filter(plugin => ['dsh-css-modules-inline', 'dsh-css-text-inline', 'dsh-image-inline', 'dsh-css-global-inline'].includes(plugin.name));
const officialAssets = { name: 'official-client-assets', setup(builder) {
  builder.onResolve({ filter: /\.(?:css(?:\?inline)?|svg|png|webp)$/ }, async args => {
    if (!args.importer.includes('/vendor/deepseek-harness/') && !args.path.includes('/vendor/deepseek-harness/')) return;
    for (const plugin of assetPlugins) {
      const path = await plugin.resolveId?.call({}, args.path, args.importer);
      if (typeof path === 'string') return { path, namespace: 'official-client-asset' };
    }
  });
  builder.onLoad({ filter: /.*/, namespace: 'official-client-asset' }, async args => {
    const watchFiles = [];
    for (const plugin of assetPlugins) {
      const contents = await plugin.load?.call({ addWatchFile:path => watchFiles.push(path) }, args.path);
      if (contents !== null && contents !== undefined) return { contents, loader: 'js', watchFiles };
    }
    throw new Error(`Official client asset loader did not handle ${args.path}`);
  });
} };
const common = { bundle: true, absWorkingDir: here, logLevel: 'info' };
const host = await build({ ...common, entryPoints: ['src/host.mjs'], outfile: 'dist/host.mjs', platform: 'node', format: 'esm', packages: 'external', metafile: true,
  plugins: [{ name: 'official-cordis-domain-sdk', setup(builder) {
    builder.onResolve({ filter: /^cordis$/ }, () => ({ path: '@deepseek-ai/cordis', external: true }));
    builder.onResolve({ filter: /^@youdub\/sdk$/ }, () => ({ path: resolve(root, 'packages/sdk/src/index.ts') }));
    builder.onResolve({ filter: /^@youdub\/sdk\// }, args => ({ path: resolve(root, 'packages/sdk/src', args.path.slice('@youdub/sdk/'.length) + '.ts') }));
  } }],
});
const controlNames = ['button', 'input', 'select', 'native-select', 'tooltip', 'label', 'tag', 'switch', 'segmented'];
const aliases = Object.fromEntries(controlNames.map(name => [`@/components/ui/${name}`, resolve(frontend, 'controls.tsx')]));
const client = await build({ ...common, entryPoints: ['src/client.jsx'], outfile: 'dist/client.js', platform: 'browser', format: 'cjs', jsx: 'automatic', metafile: true,
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-store'], loader: { '.css': 'text' }, nodePaths: [resolve(here, 'node_modules'), resolve(web, 'node_modules')],
  define: { 'process.env.DSH_CLIENT_VERSION': JSON.stringify(product.version), 'process.env.DSH_CLIENT_TITLE': JSON.stringify('YouDub') },
  alias: { ...aliases, '@base-ui/react/dialog': resolve(frontend, 'dialog.tsx'), '@base-ui/react/popover': resolve(frontend, 'popover.tsx'), '@/lib/asset-url': resolve(frontend, 'asset-url.ts'), '@/lib/clipboard': resolve(frontend, 'clipboard.ts'), '@/lib/i18n': resolve(frontend, 'i18n.tsx'), '@/lib/theme': resolve(frontend, 'theme.tsx'), '@/components/inline-alert': resolve(frontend, 'alerts.tsx'), '@/components/video-player': resolve(frontend, 'video-player.tsx'), '@': resolve(web, 'src') },
  plugins: [sourceBuiltImports, officialAssets, { name: 'youdub-component-boundaries', setup(builder) {
    builder.onResolve({ filter: /^cordis$/ }, () => ({ path: '@deepseek-ai/cordis', external: true }));
    builder.onResolve({ filter: /^zustand\/vanilla$/ }, args => args.importer.startsWith(resolve(web, 'src')) ? { path: resolve(frontend, 'store.ts') } : undefined);
    builder.onResolve({ filter: /^lucide-react$/ }, args => args.importer !== resolve(frontend, 'icons.tsx') ? { path: resolve(frontend, 'icons.tsx') } : undefined);
    builder.onResolve({ filter: /(?:^|\/)ui\/[\w-]+(?:\.tsx)?$/ }, args => {
      if (!args.importer.startsWith(resolve(web, 'src'))) return;
      const target = resolve(dirname(args.importer), args.path).replace(/\.tsx$/, '');
      if (controlNames.some(name => target === resolve(web, 'src/components/ui', name))) return { path: resolve(frontend, 'controls.tsx') };
    });
    builder.onResolve({ filter: /(?:^|\/)sdk(?:\.tsx)?$/ }, args => {
      if (!args.importer.startsWith(resolve(web, 'src'))) return;
      const target = resolve(dirname(args.importer), args.path).replace(/\.tsx$/, '');
      if (args.path === '@/plugin/sdk' || target === resolve(web, 'src/plugin/sdk')) return { path: resolve(frontend, 'sdk.tsx') };
    });
    builder.onResolve({ filter: /^youdub:styles$/ }, () => ({ path: 'styles', namespace: 'youdub-styles' }));
    builder.onResolve({ filter: /^youdub:logo$/ }, () => ({ path: 'logo', namespace: 'youdub-logo' }));
    builder.onLoad({ filter: /.*/, namespace: 'youdub-logo' }, async () => ({ contents: 'export default ' + JSON.stringify('data:image/svg+xml;base64,' + (await readFile(resolve(web, 'public/youdub-logo.svg'))).toString('base64')), loader: 'js' }));
    builder.onLoad({ filter: /.*/, namespace: 'youdub-styles' }, async () => {
      const postcss = webRequire('postcss');
      const tailwind = webRequire('@tailwindcss/postcss');
      const source = postcss.parse(await readFile(resolve(web, 'src/app/globals.css'), 'utf8'));
      source.walkAtRules('import', rule => rule.remove());
      source.walkAtRules('custom-variant', rule => {
        if (rule.params.startsWith('dark ')) rule.params = 'dark (&:is(.dark *, [data-ds-dark-theme] *))';
      });
      source.walkAtRules('layer', rule => { if (rule.params === 'base') rule.remove(); });
      source.walkRules(rule => { if (rule.selector === ':root' || rule.selector === '.dark') rule.remove(); });
      const input = `@layer theme, base, components, utilities;\n@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities) important source(none);\n@source "${resolve(web, 'src')}";\n@source "${frontend}";\n${source}`;
      const result = await postcss([tailwind({ base: web, optimize: false })]).process(input, { from: resolve(web, 'youdub-harness.css') });
      const workflow = await readFile(resolve(web, 'src/plugin/builtin/workflow.css'), 'utf8');
      const flow = await readFile(webRequire.resolve('@xyflow/react/dist/style.css'), 'utf8');
      return { contents: 'export default ' + JSON.stringify(result.css + '\n' + flow + '\n' + workflow), loader: 'js' };
    });
  } }, { name: 'original-youdub-theme', setup(builder) {
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
        'state-business-primary': 'link', 'state-success-primary': 'status-success-fg',
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
await writeFile(resolve(here, 'dist/build-inputs.json'), JSON.stringify({ host: host.metafile, client: client.metafile }, null, 2) + '\n');
