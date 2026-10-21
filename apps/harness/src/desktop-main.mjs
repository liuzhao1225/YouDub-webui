import { app } from 'electron';

// Product composition uses the reviewed Harness Desktop fork.
app.setName('YouDub');
await import('./lib/youdub-main.js');
