import { app, nativeImage } from 'electron';
import { join } from 'node:path';

// Product composition uses the reviewed Harness Desktop fork.
app.setName('YouDub');
const iconPath = join(app.getAppPath(), 'resources/youdub-icon.png');
const icon = nativeImage.createFromPath(iconPath);
if (icon.isEmpty()) throw new Error(`Cannot load YouDub application icon: ${iconPath}`);
void app.whenReady().then(() => app.dock?.setIcon(icon));
app.on('browser-window-created', (_event, window) => {
  if (process.platform !== 'darwin') window.setIcon(icon);
});
await import('./lib/youdub-main.js');
