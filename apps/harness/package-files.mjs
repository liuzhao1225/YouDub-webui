/** Desktop payload: compiled code and runtime assets, without framework development inputs. */
export const desktopFiles = [
  'main.mjs', 'lib/**/*', 'resources/**/*', 'scripts/**/*', 'desktop-runtime.json', 'package.json',
  '!**/*.map',
  '!node_modules/{openai,zod,@anthropic-ai/sdk}/src{,/**}',
  '!node_modules/gaxios/build/{cjs,esm}/test{,/**}',
  '!node_modules/@deepseek-ai/*/{src,tests,test,__tests__}{,/**}',
  '!node_modules/@deepseek-ai/*/{tsconfig*.json,*.ts,*.tsx,README*,AGENTS.md}',
  '!node_modules/@deepseek-ai/dsh-web-frontend/{public,lib,index.html}{,/**}',
];

// Runtime-read sources provide execution fingerprints; all executable TypeScript
// is already in the Host bundle. Keep the media worker and its runtime assets.
export const productResources = [
  'package.json', 'backend/__init__.py', 'backend/app/**/*', 'backend/workers/**/*',
  'backend/requirements*.txt', 'backend/requirements/**/*',
  'packages/sdk/src/video-source.ts',
  'packages/builtin/src/workflow-localize.ts',
  'packages/builtin/src/workflow-graph.ts',
  'packages/builtin/src/workflow-document.ts',
  'packages/builtin/src/media-graph-validation.ts',
  'packages/builtin/src/media-output-validation.ts',
  'submodule/**/*', 'site/assets/jensen-en.mp4',
  '!**/__pycache__/**', '!**/.git{,/**}', '!**/node_modules/**', '!**/.env', '!**/env.txt',
];
