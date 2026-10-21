import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { closeRendererBeforeQuit } from '../src/desktop-unload.ts';

function renderer(dirty = false) {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  let destroyed = false;
  window.isDestroyed = () => destroyed;
  window.close = () => {
    if (dirty) {
      let proceed = false;
      window.webContents.emit('will-prevent-unload', { preventDefault() { proceed = true; } });
      if (!proceed) return;
    }
    destroyed = true;
    window.emit('closed');
  };
  return window;
}

test('renderer cancellation keeps the window and Host available, then a later confirmed quit can close', async () => {
  const window = renderer(true);
  let stopped = false;
  if (await closeRendererBeforeQuit(window, () => false)) stopped = true;
  assert.equal(stopped, false);
  assert.equal(window.isDestroyed(), false);
  assert.equal(window.listenerCount('closed'), 0);
  assert.equal(window.webContents.listenerCount('will-prevent-unload'), 0);
  if (await closeRendererBeforeQuit(window, () => true)) stopped = true;
  assert.equal(stopped, true);
  assert.equal(window.isDestroyed(), true);
});

test('clean and already closed renderers need no discard confirmation', async () => {
  const window = renderer();
  const unexpected = () => { throw new Error('Clean renderer requested confirmation'); };
  assert.equal(await closeRendererBeforeQuit(window, unexpected), true);
  assert.equal(await closeRendererBeforeQuit(window, unexpected), true);
});

test('Host shutdown waits for the actual closed event after the renderer permits leaving', async () => {
  const window = renderer();
  window.close = () => {};
  let stopped = false;
  const result = closeRendererBeforeQuit(window, () => true).then(value => { stopped = value; });
  await Promise.resolve();
  assert.equal(stopped, false);
  window.emit('closed');
  await result;
  assert.equal(stopped, true);
});

test('close and dialog failures preserve the cause and remove listeners without claiming a successful close', async () => {
  for (const where of ['close', 'dialog']) {
    const window = renderer(true), failure = new Error(`${where} failed`);
    if (where === 'close') window.close = () => { throw failure; };
    await assert.rejects(closeRendererBeforeQuit(window, () => { throw failure; }), error => error === failure);
    assert.equal(window.isDestroyed(), false);
    assert.equal(window.listenerCount('closed'), 0);
    assert.equal(window.webContents.listenerCount('will-prevent-unload'), 0);
  }
});
