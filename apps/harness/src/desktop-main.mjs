import { app, nativeImage } from 'electron';
import { join } from 'node:path';

// Product composition uses the reviewed Harness Desktop fork.
app.setName('YouDub');
if (app.isPackaged) {
  // Installed builds own their runtime; Finder and Explorer supply no development paths.
  const runtime = app.getAppPath();
  process.env.DSH_HOME ||= join(app.getPath('userData'), 'harness');
  process.env.DSH_DESKTOP_DSH_DIR = runtime;
  process.env.DSH_DESKTOP_PNPM_ENTRY = join(runtime, 'node_modules/pnpm/bin/pnpm.mjs');
  process.env.YOUDUB_HARNESS_PLUGIN_ROOT = join(runtime, 'node_modules/@youdub/harness-subtitles');
  process.env.YOUDUB_MEDIA_ROOT = join(process.resourcesPath, 'youdub');
  process.env.YOUDUB_NODE_PATH = process.execPath;
}
const iconPath = join(app.getAppPath(), 'resources/youdub-icon.png');
const icon = nativeImage.createFromPath(iconPath);
if (icon.isEmpty()) throw new Error(`Cannot load YouDub application icon: ${iconPath}`);
void app.whenReady().then(() => app.dock?.setIcon(icon));
app.on('browser-window-created', (_event, window) => {
  if (process.platform !== 'darwin') window.setIcon(icon);
});
await import('./lib/youdub-main.js');
