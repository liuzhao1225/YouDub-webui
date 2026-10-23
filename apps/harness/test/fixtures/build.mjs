import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
for (const slug of ['file-transform','graph-text-review','python-text']) {
  const root = fileURLToPath(new URL(`./${slug}/`, import.meta.url));
  const manifest = JSON.parse(await readFile(new URL(`./${slug}/package.json`, import.meta.url), 'utf8'));
  await build({ absWorkingDir:root,entryPoints:['src/host.mjs'],outfile:'dist/host.mjs',bundle:true,platform:'node',format:'esm',packages:'external' });
  if (manifest.dsh.client) await build({ absWorkingDir:root,entryPoints:['src/client.jsx'],outfile:'dist/client.js',bundle:true,platform:'browser',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives'],
    banner:{ js:`window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;` },footer:{js:'return module.exports;}});'} });
}
