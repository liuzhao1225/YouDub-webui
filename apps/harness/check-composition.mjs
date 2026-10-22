import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const metadata = JSON.parse(await readFile(resolve(here, 'dist/build-inputs.json'), 'utf8'));
const forbidden = {
  host: [/apps\/host\//, /packages\/builtin\/src\/(?:process|http|auth|secrets|settings|llm-models|llm-models-api|setup|bootstrap|extensions|extensions-loader)\.ts$/],
  client: [/web\/src\/main\.tsx$/, /web\/src\/plugin\/(?:bootstrap|web-react|runtime\/(?:navigation|session|slots))\./, /web\/src\/components\/models-settings\//, /node_modules\/@base-ui\//, /vendor\/deepseek-harness\/source\/packages\/client\/ui-primitives\/src\/.*\.tsx?$/],
};
const failures = [];
const report = {};
for (const [side, metafile] of Object.entries(metadata)) {
  const active = new Set();
  const imports = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const [path, value] of Object.entries(output.inputs)) if (value.bytesInOutput) active.add(path);
    for (const item of output.imports) if (item.external) imports.add(item.path);
  }
  for (const path of active) {
    if (forbidden[side].some(pattern => pattern.test(path)) || /node_modules\/(?:cordis|@cordisjs|react|react-dom)\//.test(path)) failures.push(`${side}: ${path}`);
  }
  report[side] = { activeModules: active.size, externalImports: [...imports].sort() };
}
if (failures.length) throw new Error('Legacy platform code entered the Harness plugin bundle:\n' + failures.join('\n'));
const desktop = JSON.parse(await readFile(resolve(here, 'dist/desktop/build-inputs.json'), 'utf8'));
const desktopInputs = Object.values(desktop.product.outputs).flatMap(output =>
  Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput).map(([path]) => path));
for (const path of desktopInputs) {
  if (/\/platform-view\.ts$/.test(path)) {
    throw new Error(`Unneeded Harness product integration entered YouDub Desktop: ${path}`);
  }
}
console.log(JSON.stringify({ passed: true, ...report }, null, 2));
