import { app } from 'electron';

// Product composition lives here; the vendored official Desktop is compiled unchanged.
app.setName('YouDub');
await import('./lib/youdub-main.js');
